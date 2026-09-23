export const TOOL_DEFINITIONS = Object.freeze({
  harmonic: {
    id: 'harmonic',
    target: 'note',
    command(target, options = {}) {
      return {
        type: 'note/technique/add',
        noteId: target.noteId,
        technique: { type: 'harmonic', kind: options.kind || 'natural' }
      };
    }
  },
  strumDown: {
    id: 'strumDown',
    target: 'event',
    command(target) {
      return { type: 'event/mark/add', eventId: target.eventId, mark: { type: 'strum', direction: 'down' } };
    }
  },
  strumUp: {
    id: 'strumUp',
    target: 'event',
    command(target) {
      return { type: 'event/mark/add', eventId: target.eventId, mark: { type: 'strum', direction: 'up' } };
    }
  },
  duration32: {
    id: 'duration32',
    target: 'event',
    command(target) {
      return { type: 'event/duration/set', eventId: target.eventId, duration: [1, 8] };
    }
  },
  triplet: {
    id: 'triplet',
    target: 'eventRange',
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
    target: 'notePair',
    command(target) {
      return {
        type: 'relation/add',
        relation: { type: 'slide', fromNoteId: target.fromNoteId, toNoteId: target.toNoteId }
      };
    }
  },
  tie: {
    id: 'tie',
    target: 'notePair',
    command(target) {
      return {
        type: 'relation/add',
        relation: { type: 'tie', fromNoteId: target.fromNoteId, toNoteId: target.toNoteId }
      };
    }
  },
  slur: {
    id: 'slur',
    target: 'notePair',
    command(target) {
      return {
        type: 'relation/add',
        relation: { type: 'slur', fromNoteId: target.fromNoteId, toNoteId: target.toNoteId }
      };
    }
  }
});

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

export const EDITOR_TOOL_MIME = 'application/x-openguitartab-tool';

export function writeToolDragData(dataTransfer, toolId, options = {}) {
  if (!dataTransfer) return;
  const payload = JSON.stringify({ toolId: String(toolId), options });
  dataTransfer.setData(EDITOR_TOOL_MIME, payload);
  dataTransfer.setData('text/plain', `tool:${toolId}`);
  dataTransfer.effectAllowed = 'copy';
}

export function readToolDragData(dataTransfer) {
  if (!dataTransfer) return null;
  const raw = dataTransfer.getData(EDITOR_TOOL_MIME);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.toolId) return parsed;
    } catch {}
  }
  const fallback = dataTransfer.getData('text/plain');
  if (fallback?.startsWith('tool:')) return { toolId: fallback.slice(5), options: {} };
  return null;
}
