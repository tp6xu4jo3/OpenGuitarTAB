function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function primaryArticulationMark(event) {
  const marks = event?.marks || [];
  return marks.find(mark => mark?.type === 'arpeggio')
    || marks.find(mark => mark?.type === 'strum')
    || null;
}

function stringOrder(mark) {
  if (mark?.type === 'strum') return mark.direction === 'up' ? 1 : -1;
  if (mark?.type === 'arpeggio') return mark.direction === 'down' ? 1 : -1;
  return 0;
}

export function playbackNoteSchedule(event, beatMs) {
  const notes = [...(event?.notes || [])];
  if (!notes.length) return [];
  const mark = primaryArticulationMark(event);
  const order = stringOrder(mark);
  if (!order || notes.length < 2) return notes.map(note => ({ note, delayMs: 0 }));

  notes.sort((left, right) => order * (Number(left.string) - Number(right.string)));
  const durationBeats = Math.max(0.001, Number(event?.durationBeats) || 0.25);
  const beatDurationMs = Math.max(1, Number(beatMs) || 500);
  const availableMs = durationBeats * beatDurationMs * 0.8;
  const desiredMs = mark.type === 'arpeggio'
    ? Math.min(220, beatDurationMs * 0.42)
    : Math.min(48, beatDurationMs * 0.085);
  const totalSpreadMs = clamp(Math.min(desiredMs, availableMs), 0, availableMs);
  const stepMs = notes.length > 1 ? totalSpreadMs / (notes.length - 1) : 0;

  return notes.map((note, index) => ({ note, delayMs: stepMs * index }));
}
