import { compareFractions, indexDocument, noteBaseFret } from './model.js';
import { eventsInTimeRange, thirtySecondRange, tripletRange } from './rhythm-grid.js';

function noteContext(index, noteId) {
  const id = String(noteId || '');
  const note = index.noteById.get(id);
  const location = index.noteLocation.get(id);
  const event = location ? index.eventById.get(location.eventId) : null;
  return note && location && event ? { note, location, event } : null;
}

function compareNoteTime(from, to) {
  if (!from || !to) return null;
  if (from.location.measureIndex !== to.location.measureIndex) {
    return Math.sign(to.location.measureIndex - from.location.measureIndex);
  }
  return compareFractions(to.event.at, from.event.at);
}

function invalid(message) {
  return { ok: false, message };
}

export function resolveTechniqueTarget(toolId, target, documentModel) {
  const id = String(toolId || '');
  const index = indexDocument(documentModel);

  if (id === 'harmonic') {
    const context = noteContext(index, target?.noteId);
    if (!context) return invalid('請點選已有品位的音符');
    const fret = Number(noteBaseFret(context.note));
    if (!Number.isFinite(fret) || fret < 1) return invalid('人工泛音需要先有1品以上的按弦音');
    return { ok: true, target: { noteId: context.note.id } };
  }

  if (['strumUp', 'strumDown', 'arpeggioUp', 'arpeggioDown'].includes(id)) {
    const event = target?.eventId ? index.eventById.get(String(target.eventId)) : null;
    if (!event) return invalid('這個時間位置沒有可套用技巧的音符');
    if ((event.notes || []).length < 2) return invalid('刷弦與琶音需要同一時間位置至少2個音符');
    return { ok: true, target: { ...target, eventId: event.id } };
  }

  if (id === 'slide' || id === 'arc') {
    const from = noteContext(index, target?.fromNoteId);
    const to = noteContext(index, target?.toNoteId);
    if (!from || !to) return invalid('請依序點選兩個有效音符');
    const order = compareNoteTime(from, to);
    if (order == null || order <= 0) return invalid('第二個音符必須位於第一個音符之後');

    if (id === 'slide') {
      if (Number(from.note.string) !== Number(to.note.string)) {
        return invalid('滑音必須連接同一條弦上的兩個音符');
      }
      if (noteBaseFret(from.note) === noteBaseFret(to.note)) {
        return invalid('滑音的起點與終點需要不同品位');
      }
      return {
        ok: true,
        target: {
          fromNoteId: from.note.id,
          toNoteId: to.note.id,
          relationType: 'slide'
        }
      };
    }

    const sameString = Number(from.note.string) === Number(to.note.string);
    const sameFret = noteBaseFret(from.note) === noteBaseFret(to.note);
    return {
      ok: true,
      target: {
        fromNoteId: from.note.id,
        toNoteId: to.note.id,
        relationType: sameString && sameFret ? 'tie' : 'slur'
      }
    };
  }

  if (id === 'triplet') {
    const measure = index.measureById.get(String(target?.measureId || ''))?.measure;
    if (!measure || !Array.isArray(target?.startAt) || !Array.isArray(target?.endAt)) {
      return invalid('請在同一小節選擇三連音範圍');
    }
    const range = tripletRange(target.startAt, target.endAt);
    const events = eventsInTimeRange(measure, range.startAt, range.endExclusive)
      .filter(event => (event.notes || []).length || (event.marks || []).length);
    if (events.length > 3) return invalid('三連音範圍最多只能包含3個既有時間事件');
    return { ok: true, target: { ...target, eventIds: events.map(event => event.id) } };
  }

  if (id === 'duration32') {
    if (!thirtySecondRange(target?.startAt, target?.endAt)) {
      return invalid('32分音只能選擇兩個相鄰的16分位置');
    }
    return { ok: true, target };
  }

  return { ok: true, target };
}
