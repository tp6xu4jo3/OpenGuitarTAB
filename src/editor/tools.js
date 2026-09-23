export const TOOL_DEFINITIONS = Object.freeze({
  harmonic: {
    id: 'harmonic',
    label: '泛音',
    glyph: '◇',
    target: 'note',
    hint: '選取後點選要套用泛音的音符',
    command(target) {
      return {
        type: 'note/technique/add',
        noteId: target.noteId,
        technique: { type: 'harmonic' }
      };
    }
  },
  strumUp: {
    id: 'strumUp',
    label: '上刷',
    glyph: '↑',
    target: 'event',
    hint: '選取後點選和弦或音符所在直欄',
    command(target) {
      return { type: 'event/mark/add', eventId: target.eventId, mark: { type: 'strum', direction: 'up' } };
    }
  },
  strumDown: {
    id: 'strumDown',
    label: '下刷',
    glyph: '↓',
    target: 'event',
    hint: '選取後點選和弦或音符所在直欄',
    command(target) {
      return { type: 'event/mark/add', eventId: target.eventId, mark: { type: 'strum', direction: 'down' } };
    }
  },
  duration32: {
    id: 'duration32',
    label: '32分音',
    glyph: '32',
    target: 'event',
    hint: '選取後點選要改成32分音的時間位置',
    command(target) {
      return { type: 'event/duration/set', eventId: target.eventId, duration: [1, 8] };
    }
  },
  triplet: {
    id: 'triplet',
    label: '三連音',
    glyph: '3',
    target: 'eventRange',
    hint: '選取後依序點選同小節的範圍起點與終點',
    command(target) {
      return {
        type: 'group/add',
        measureId: target.measureId,
        group: { type: 'tuplet', ratio: [3, 2], eventIds: [...(target.eventIds || [])] }
      };
    }
  },
  slide: {
    id: 'slide',
    label: '滑音',
    glyph: '/',
    target: 'notePair',
    hint: '選取後依序點選兩個音符',
    command(target) {
      return {
        type: 'relation/add',
        relation: { type: 'slide', fromNoteId: target.fromNoteId, toNoteId: target.toNoteId }
      };
    }
  },
  tie: {
    id: 'tie',
    label: '延音線',
    glyph: '⌒',
    target: 'notePair',
    hint: '選取後依序點選兩個音符',
    command(target) {
      return {
        type: 'relation/add',
        relation: { type: 'tie', fromNoteId: target.fromNoteId, toNoteId: target.toNoteId }
      };
    }
  },
  slur: {
    id: 'slur',
    label: '圓滑線',
    glyph: '︵',
    target: 'notePair',
    hint: '選取後依序點選兩個音符',
    command(target) {
      return {
        type: 'relation/add',
        relation: { type: 'slur', fromNoteId: target.fromNoteId, toNoteId: target.toNoteId }
      };
    }
  }
});

export function eventRangeFromEvent(documentModel, eventId, count = 3) {
  const size = Math.max(1, Math.trunc(Number(count) || 1));
  const id = String(eventId || '');
  if (!id) return null;

  for (const measure of documentModel?.measures || []) {
    const eventIndex = (measure.events || []).findIndex(event => String(event.id) === id);
    if (eventIndex < 0) continue;
    const events = measure.events.slice(eventIndex, eventIndex + size);
    if (events.length !== size) return null;
    return {
      measureId: measure.id,
      eventIds: events.map(event => event.id)
    };
  }
  return null;
}

export class ToolRegistry {
  constructor(definitions = TOOL_DEFINITIONS) {
    this.definitions = new Map(Object.values(definitions).map(definition => [definition.id, definition]));
  }

  register(definition) {
    if (!definition?.id || !definition?.target || typeof definition.command !== 'function') {
      throw new Error('INVALID_EDITOR_TOOL');
    }
    this.definitions.set(String(definition.id), definition);
    return definition;
  }

  get(toolId) {
    return this.definitions.get(String(toolId || '')) || null;
  }

  list() {
    return [...this.definitions.values()];
  }

  createCommand(toolId, target, options = {}) {
    const definition = this.get(toolId);
    if (!definition) throw new Error(`UNKNOWN_EDITOR_TOOL:${toolId}`);
    return definition.command(target || {}, options);
  }
}
