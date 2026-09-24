export const TOOL_TARGET_KINDS = Object.freeze({
  NOTE: 'NoteTarget',
  COLUMN: 'ColumnTarget',
  NOTE_PAIR: 'NotePairTarget',
  RANGE: 'RangeTarget'
});

const TARGET_KIND_BY_TOOL_TARGET = Object.freeze({
  note: TOOL_TARGET_KINDS.NOTE,
  event: TOOL_TARGET_KINDS.COLUMN,
  column: TOOL_TARGET_KINDS.COLUMN,
  notePair: TOOL_TARGET_KINDS.NOTE_PAIR,
  eventRange: TOOL_TARGET_KINDS.RANGE,
  NoteTarget: TOOL_TARGET_KINDS.NOTE,
  ColumnTarget: TOOL_TARGET_KINDS.COLUMN,
  NotePairTarget: TOOL_TARGET_KINDS.NOTE_PAIR,
  RangeTarget: TOOL_TARGET_KINDS.RANGE
});

function fractionNumber(value) {
  if (!Array.isArray(value) || value.length < 2) return NaN;
  const numerator = Number(value[0]);
  const denominator = Number(value[1]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return NaN;
  return numerator / denominator;
}

function sameAt(left, right) {
  const a = fractionNumber(left);
  const b = fractionNumber(right);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function orderedRange(first, second) {
  return fractionNumber(first.at) <= fractionNumber(second.at)
    ? { startAt: first.at, endAt: second.at }
    : { startAt: second.at, endAt: first.at };
}

export function toolTargetKind(definition) {
  return TARGET_KIND_BY_TOOL_TARGET[definition?.target] || null;
}

export class ToolSession {
  constructor() {
    this.cancel();
  }

  get active() {
    return Boolean(this.toolId);
  }

  snapshot() {
    return {
      state: this.active ? (this.firstTarget ? 'selecting-target' : 'selected') : 'idle',
      toolId: this.toolId,
      targetKind: this.targetKind,
      firstTarget: this.firstTarget ? { ...this.firstTarget } : null
    };
  }

  activate(toolId, targetKind) {
    const id = String(toolId || '');
    if (!id || !targetKind) {
      this.cancel();
      return this.snapshot();
    }
    if (this.toolId === id) {
      this.cancel();
      return this.snapshot();
    }
    this.toolId = id;
    this.targetKind = targetKind;
    this.firstTarget = null;
    return this.snapshot();
  }

  cancel() {
    this.toolId = null;
    this.targetKind = null;
    this.firstTarget = null;
    return this.snapshot?.() || { state: 'idle', toolId: null, targetKind: null, firstTarget: null };
  }

  commitSuccess({ keepActive = false } = {}) {
    if (!keepActive) return this.cancel();
    this.firstTarget = null;
    return this.snapshot();
  }

  select(target) {
    if (!this.active || !target) return { status: 'invalid', reason: 'no-target' };

    if (this.targetKind === TOOL_TARGET_KINDS.NOTE_PAIR) {
      const noteId = String(target.noteId || '');
      if (!noteId) return { status: 'invalid', reason: 'note-required' };
      if (!this.firstTarget) {
        this.firstTarget = { noteId };
        return { status: 'pending', source: { ...this.firstTarget } };
      }
      if (String(this.firstTarget.noteId) === noteId) {
        return { status: 'invalid', reason: 'same-note', source: { ...this.firstTarget } };
      }
      return {
        status: 'complete',
        target: {
          fromNoteId: String(this.firstTarget.noteId),
          toNoteId: noteId
        },
        source: { ...this.firstTarget }
      };
    }

    if (this.targetKind === TOOL_TARGET_KINDS.RANGE) {
      const measureId = String(target.measureId || '');
      if (!measureId || !Array.isArray(target.at)) return { status: 'invalid', reason: 'position-required' };
      const endpoint = { measureId, at: [...target.at] };
      if (!this.firstTarget) {
        this.firstTarget = endpoint;
        return { status: 'pending', source: { ...endpoint, at: [...endpoint.at] } };
      }
      if (String(this.firstTarget.measureId) !== measureId) {
        return { status: 'invalid', reason: 'same-measure-required', source: { ...this.firstTarget } };
      }
      if (sameAt(this.firstTarget.at, endpoint.at)) {
        return { status: 'invalid', reason: 'different-position-required', source: { ...this.firstTarget } };
      }
      const range = orderedRange(this.firstTarget, endpoint);
      return {
        status: 'complete',
        target: {
          measureId,
          startAt: [...range.startAt],
          endAt: [...range.endAt]
        },
        source: { ...this.firstTarget, at: [...this.firstTarget.at] }
      };
    }

    return { status: 'complete', target: { ...target } };
  }
}
