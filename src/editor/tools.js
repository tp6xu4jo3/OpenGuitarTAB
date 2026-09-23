export const TOOL_DEFINITIONS = Object.freeze({
  harmonic: {
    id: 'harmonic',
    label: '泛音',
    glyph: '◇',
    target: 'note',
    hint: '人工泛音：點選1品以上的音符，顯示左手品位與+12觸弦點',
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
    hint: '點選同一時間位置的和弦，加入向上刷弦',
    command(target) {
      return { type: 'event/mark/add', eventId: target.eventId, mark: { type: 'strum', direction: 'up' } };
    }
  },
  strumDown: {
    id: 'strumDown',
    label: '下刷',
    glyph: '↓',
    target: 'event',
    hint: '點選同一時間位置的和弦，加入向下刷弦',
    command(target) {
      return { type: 'event/mark/add', eventId: target.eventId, mark: { type: 'strum', direction: 'down' } };
    }
  },
  arpeggioUp: {
    id: 'arpeggioUp',
    label: '向上琶音',
    glyph: '≋↑',
    target: 'event',
    hint: '點選同一時間位置的和弦，加入向上琶音',
    command(target) {
      return { type: 'event/mark/add', eventId: target.eventId, mark: { type: 'arpeggio', direction: 'up' } };
    }
  },
  arpeggioDown: {
    id: 'arpeggioDown',
    label: '向下琶音',
    glyph: '≋↓',
    target: 'event',
    hint: '點選同一時間位置的和弦，加入向下琶音',
    command(target) {
      return { type: 'event/mark/add', eventId: target.eventId, mark: { type: 'arpeggio', direction: 'down' } };
    }
  },
  arc: {
    id: 'arc',
    label: '弧線',
    glyph: '⌒',
    target: 'notePair',
    hint: '依序點選兩個音符；同弦同品位建立延音，其餘建立圓滑線',
    command(target) {
      return {
        type: 'relation/add',
        relation: {
          type: target.relationType === 'tie' ? 'tie' : 'slur',
          fromNoteId: target.fromNoteId,
          toNoteId: target.toNoteId
        }
      };
    }
  },
  slide: {
    id: 'slide',
    label: '滑音',
    glyph: '/',
    target: 'notePair',
    hint: '依序點選同一條弦、不同品位的兩個音符',
    command(target) {
      return {
        type: 'relation/add',
        relation: { type: 'slide', fromNoteId: target.fromNoteId, toNoteId: target.toNoteId }
      };
    }
  },
  triplet: {
    id: 'triplet',
    label: '三連音',
    glyph: '3',
    target: 'eventRange',
    hint: '依序點選同小節的範圍起點與終點，將範圍切成3個真正的3:2時間位置',
    command(target) {
      return {
        type: 'rhythm/triplet/apply',
        measureId: target.measureId,
        startAt: [...target.startAt],
        endAt: [...target.endAt]
      };
    }
  },
  duration32: {
    id: 'duration32',
    label: '32分音',
    glyph: '32',
    target: 'eventRange',
    hint: '依序點選兩個相鄰16分位置，將區間切成2個32分位置',
    command(target) {
      return {
        type: 'rhythm/32nd/apply',
        measureId: target.measureId,
        startAt: [...target.startAt],
        endAt: [...target.endAt]
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
