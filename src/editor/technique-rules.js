import { compareFractions, indexDocument, noteBaseFret } from './model.js';

function noteContext(documentModel, noteId) {
  const index = indexDocument(documentModel);
  const note = index.noteById.get(String(noteId || ''));
  const location = index.noteLocation.get(String(noteId || ''));
  const event = location ? index.eventById.get(location.eventId) : null;
  return note && location && event ? { note, location, event, index } : null;
}

function compareNoteTime(documentModel, fromId, toId) {
  const from = noteContext(documentModel, fromId);
  const to = noteContext(documentModel, toId);
  if (!from || !to) return null;
  if (from.location.measureIndex !== to.location.measureIndex) {
    return Math.sign(to.location.measureIndex - from.location.measureIndex);
  }
  return compareFractions(to.event.at, from.event.at);
}

function pairContext(documentModel, target) {
  const from = noteContext(documentModel, target?.fromNoteId);
  const to = noteContext(documentModel, target?.toNoteId);
  if (!from || !to) return null;
  return { from, to, order: compareNoteTime(documentModel, target.fromNoteId, target.toNoteId) };
}

function invalid(message) {
  return { ok: false, message };
}

export function resolveTechniqueTarget(toolId, target, documentModel) {
  const id = String(toolId || '');

  if (id === 'harmonic') {
    const context = noteContext(documentModel, target?.noteId);
    if (!context) return invalid('請點選已有品位的音符');
    const fret = Number(noteBaseFret(context.note));
    if (!Number.isFinite(fret) || fret < 1) return invalid('人工泛音需要先有1品以上的按弦音');
    return { ok: true, target: { noteId: context.note.id } };
  }

  if (['strumUp', 'strumDown', 'arpeggioUp', 'arpeggioDown'].includes(id)) {
    const event = target?.eventId ? indexDocument(documentModel).eventById.get(String(target.eventId)) : null;
    if (!event) return invalid('這個時間位置沒有可套用技巧的音符');
    if ((event.notes || []).length < 2) return invalid('刷弦與琶音需要同一時間位置至少2個音符');
    return { ok: true, target: { ...target, eventId: event.id } };
  }

  if (id === 'slide' || id === 'arc') {
    const pair = pairContext(documentModel, target);
    if (!pair) return invalid('請依序點選兩個有效音符');
    if (pair.order == null || pair.order <= 0) return invalid('第二個音符必須位於第一個音符之後');

    if (id === 'slide') {
      if (Number(pair.from.note.string) !== Number(pair.to.note.string)) {
        return invalid('滑音必須連接同一條弦上的兩個音符');
      }
      if (noteBaseFret(pair.from.note) === noteBaseFret(pair.to.note)) {
        return invalid('滑音的起點與終點需要不同品位');
      }
      return {
        ok: true,
        target: {
          fromNoteId: pair.from.note.id,
          toNoteId: pair.to.note.id,
          relationType: 'slide'
        }
      };
    }

    const sameString = Number(pair.from.note.string) === Number(pair.to.note.string);
    const sameFret = noteBaseFret(pair.from.note) === noteBaseFret(pair.to.note);
    return {
      ok: true,
      target: {
        fromNoteId: pair.from.note.id,
        toNoteId: pair.to.note.id,
        relationType: sameString && sameFret ? 'tie' : 'slur'
      }
    };
  }

  return { ok: true, target };
}
