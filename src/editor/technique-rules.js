import { compareFractions, indexDocument, noteBaseFret } from './model.js';
import {
  eventsInTimeRange,
  rhythmRangeFitsMeasure,
  thirtySecondFromStart,
  tripletFromStart
} from './rhythm-grid.js';

const NATURAL_HARMONIC_FRETS = new Set([3, 4, 5, 7, 9]);

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

function measureForColumn(index, target) {
  return index.measureById.get(String(target?.measureId || ''))?.measure || null;
}

function eventAt(measure, at) {
  return (measure?.events || []).find(event => compareFractions(event.at, at) === 0) || null;
}

export function resolveTechniqueTarget(toolId, target, documentModel) {
  const id = String(toolId || '');
  const index = indexDocument(documentModel);

  if (id === 'harmonic') {
    const context = noteContext(index, target?.noteId);
    if (!context) return invalid('請點選已有品位的音符');
    const fret = Number(noteBaseFret(context.note));
    const allowed = Number.isInteger(fret) && (NATURAL_HARMONIC_FRETS.has(fret) || fret >= 12);
    if (!allowed) return invalid('泛音只支援自然泛音位置（3、4、5、7、9品）或12品以上');
    return { ok: true, target: { noteId: context.note.id } };
  }

  if (['strumUp', 'strumDown', 'arpeggioUp', 'arpeggioDown'].includes(id)) {
    const event = target?.eventId ? index.eventById.get(String(target.eventId)) : null;
    if (!event) return invalid('這個時間位置沒有可套用技巧的音符');
    if ((event.notes || []).length < 2) return invalid('刷弦與琶音需要同一時間位置至少2個音符');
    return { ok: true, target: { ...target, eventId: event.id } };
  }

  if (id === 'arc' || id === 'arcDown') {
    const measure = measureForColumn(index, target);
    if (!measure || !Array.isArray(target?.startAt) || !Array.isArray(target?.endAt)) {
      return invalid('請選擇同一小節內的弧線起點與終點');
    }
    if (compareFractions(target.startAt, target.endAt) >= 0) return invalid('弧線終點必須位於起點之後');
    const sourceNotes = eventAt(measure, target.startAt)?.notes || [];
    const fromNote = id === 'arcDown' ? sourceNotes.at(-1) : sourceNotes[0];
    if (!fromNote) return invalid('弧線起點需要有音符；終點可以是空格');
    return {
      ok: true,
      target: {
        measureId: measure.id,
        startAt: [...target.startAt],
        endAt: [...target.endAt],
        fromNoteId: fromNote.id
      }
    };
  }

  if (id === 'slide') {
    const from = noteContext(index, target?.fromNoteId);
    const to = noteContext(index, target?.toNoteId);
    if (!from || !to) return invalid('請依序點選兩個有效音符');
    const order = compareNoteTime(from, to);
    if (order == null || order <= 0) return invalid('第二個音符必須位於第一個音符之後');
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

  if (id === 'triplet' || id === 'triplet16') {
    const measure = measureForColumn(index, target);
    if (!measure || !Array.isArray(target?.at)) return invalid('請點選小節內的時間位置');
    const subdivision = id === 'triplet16' ? 'sixteenth' : 'eighth';
    const range = tripletFromStart(target.at, subdivision);
    if (!rhythmRangeFitsMeasure(measure, range)) return invalid('這個位置右側空間不足以建立三連音');
    const events = eventsInTimeRange(measure, range.startAt, range.endExclusive)
      .filter(event => (event.notes || []).length || (event.marks || []).length || !event.rhythmOnly);
    if (events.length > 3) return invalid('三連音區間已有太多音符，請先整理該拍內容');
    return { ok: true, target: { ...target, subdivision, eventIds: events.map(event => event.id) } };
  }

  if (id === 'duration32') {
    const measure = measureForColumn(index, target);
    if (!measure || !Array.isArray(target?.at)) return invalid('請點選小節內的16分位置');
    const range = thirtySecondFromStart(target.at);
    if (!rhythmRangeFitsMeasure(measure, range)) return invalid('這個位置右側空間不足以建立32分音');
    const events = eventsInTimeRange(measure, range.startAt, range.endExclusive)
      .filter(event => (event.notes || []).length || (event.marks || []).length || !event.rhythmOnly);
    if (events.length > 2) return invalid('這個16分區間已有太多音符');
    return { ok: true, target };
  }

  return { ok: true, target };
}
