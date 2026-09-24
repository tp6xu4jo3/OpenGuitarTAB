export const STANDARD_TUNING = Object.freeze({
  id: 'standard',
  label: 'EADGBE',
  openPitchClasses: Object.freeze([4, 11, 7, 2, 9, 4])
});

export const CHORD_ROOTS = Object.freeze([
  { id: 'C', label: 'C', pitchClass: 0 },
  { id: 'C#', label: 'C♯', pitchClass: 1 },
  { id: 'D', label: 'D', pitchClass: 2 },
  { id: 'Eb', label: 'E♭', pitchClass: 3 },
  { id: 'E', label: 'E', pitchClass: 4 },
  { id: 'F', label: 'F', pitchClass: 5 },
  { id: 'F#', label: 'F♯', pitchClass: 6 },
  { id: 'G', label: 'G', pitchClass: 7 },
  { id: 'Ab', label: 'A♭', pitchClass: 8 },
  { id: 'A', label: 'A', pitchClass: 9 },
  { id: 'Bb', label: 'B♭', pitchClass: 10 },
  { id: 'B', label: 'B', pitchClass: 11 }
].map(root => Object.freeze(root)));

export const CHORD_CATEGORIES = Object.freeze([
  { id: 'major', label: '大調' },
  { id: 'minor', label: '小調' },
  { id: 'dominant', label: '屬和弦' },
  { id: 'suspended', label: '掛留' },
  { id: 'other', label: '其他' }
].map(category => Object.freeze(category)));

export const CHORD_QUALITIES = Object.freeze([
  { id: 'maj', label: 'Maj', suffix: '', category: 'major', intervals: [0, 4, 7] },
  { id: 'maj7', label: 'Maj7', suffix: 'maj7', category: 'major', intervals: [0, 4, 7, 11] },
  { id: 'maj9', label: 'Maj9', suffix: 'maj9', category: 'major', intervals: [0, 2, 4, 7, 11] },
  { id: '6', label: '6', suffix: '6', category: 'major', intervals: [0, 4, 7, 9] },
  { id: 'm', label: 'm', suffix: 'm', category: 'minor', intervals: [0, 3, 7] },
  { id: 'm7', label: 'm7', suffix: 'm7', category: 'minor', intervals: [0, 3, 7, 10] },
  { id: 'm9', label: 'm9', suffix: 'm9', category: 'minor', intervals: [0, 2, 3, 7, 10] },
  { id: 'm6', label: 'm6', suffix: 'm6', category: 'minor', intervals: [0, 3, 7, 9] },
  { id: 'm7b5', label: 'm7♭5', suffix: 'm7♭5', category: 'minor', intervals: [0, 3, 6, 10] },
  { id: '7', label: '7', suffix: '7', category: 'dominant', intervals: [0, 4, 7, 10] },
  { id: '9', label: '9', suffix: '9', category: 'dominant', intervals: [0, 2, 4, 7, 10] },
  { id: '7sus4', label: '7sus4', suffix: '7sus4', category: 'dominant', intervals: [0, 5, 7, 10] },
  { id: 'sus2', label: 'sus2', suffix: 'sus2', category: 'suspended', intervals: [0, 2, 7] },
  { id: 'sus4', label: 'sus4', suffix: 'sus4', category: 'suspended', intervals: [0, 5, 7] },
  { id: '5', label: '5', suffix: '5', category: 'other', intervals: [0, 7] },
  { id: 'dim', label: 'dim', suffix: 'dim', category: 'other', intervals: [0, 3, 6] },
  { id: 'dim7', label: 'dim7', suffix: 'dim7', category: 'other', intervals: [0, 3, 6, 9] },
  { id: 'aug', label: 'aug', suffix: 'aug', category: 'other', intervals: [0, 4, 8] }
].map(quality => Object.freeze({ ...quality, intervals: Object.freeze([...quality.intervals]) })));

const OPEN_VOICINGS = Object.freeze({
  'C:maj': Object.freeze([0, 1, 0, 2, 3, 'x']),
  'D:maj': Object.freeze([2, 3, 2, 0, 'x', 'x']),
  'E:maj': Object.freeze([0, 0, 1, 2, 2, 0]),
  'G:maj': Object.freeze([3, 0, 0, 0, 2, 3]),
  'A:maj': Object.freeze([0, 2, 2, 2, 0, 'x']),
  'A:m': Object.freeze([0, 1, 2, 2, 0, 'x']),
  'D:m': Object.freeze([1, 3, 2, 0, 'x', 'x']),
  'E:m': Object.freeze([0, 0, 0, 2, 2, 0])
});

const ROOT_BY_ID = new Map(CHORD_ROOTS.map(root => [root.id, root]));
const QUALITY_BY_ID = new Map(CHORD_QUALITIES.map(quality => [quality.id, quality]));

function pitchClass(value) {
  const numeric = Math.trunc(Number(value) || 0);
  return ((numeric % 12) + 12) % 12;
}

function nearestFret(openPitchClass, targetPitchClass, anchorFret) {
  const base = pitchClass(targetPitchClass - openPitchClass);
  let best = base;
  let bestDistance = Infinity;
  for (let octave = 0; octave <= 2; octave++) {
    const fret = base + octave * 12;
    const distance = Math.abs(fret - anchorFret);
    if (distance < bestDistance) {
      best = fret;
      bestDistance = distance;
    }
  }
  return best;
}

function movableVoicing(root, quality) {
  const anchorBase = pitchClass(root.pitchClass - STANDARD_TUNING.openPitchClasses[5]);
  const anchor = anchorBase === 0 ? 12 : anchorBase;
  const frets = Array(6).fill('x');
  const unusedStrings = new Set([4, 3, 2, 1, 0]);
  frets[5] = anchor;

  for (const interval of quality.intervals.filter(value => value !== 0)) {
    let best = null;
    for (const string of unusedStrings) {
      const target = pitchClass(root.pitchClass + interval);
      const fret = nearestFret(STANDARD_TUNING.openPitchClasses[string], target, anchor);
      const score = Math.abs(fret - anchor) * 10 + string;
      if (!best || score < best.score) best = { string, fret, score };
    }
    if (!best) continue;
    frets[best.string] = best.fret;
    unusedStrings.delete(best.string);
  }

  for (const string of unusedStrings) {
    let best = null;
    for (const interval of quality.intervals) {
      const target = pitchClass(root.pitchClass + interval);
      const fret = nearestFret(STANDARD_TUNING.openPitchClasses[string], target, anchor);
      const score = Math.abs(fret - anchor) * 10 + interval;
      if (!best || score < best.score) best = { fret, score };
    }
    if (best) frets[string] = best.fret;
  }

  return frets;
}

function chordSymbol(root, quality) {
  return `${root.label}${quality.suffix}`;
}

function freezeVoicing(voicing) {
  return Object.freeze({
    ...voicing,
    frets: Object.freeze([...voicing.frets])
  });
}

function buildChord(root, quality) {
  const id = `${root.id}:${quality.id}`;
  const voicings = [];
  const open = OPEN_VOICINGS[id];
  if (open) {
    voicings.push(freezeVoicing({
      id: `${id}:open`,
      tuning: STANDARD_TUNING.id,
      frets: open
    }));
  }
  const movable = movableVoicing(root, quality);
  const duplicateOpen = open && JSON.stringify(open) === JSON.stringify(movable);
  if (!duplicateOpen) {
    voicings.push(freezeVoicing({
      id: `${id}:movable`,
      tuning: STANDARD_TUNING.id,
      frets: movable
    }));
  }
  return Object.freeze({
    id,
    root: root.id,
    quality: quality.id,
    symbol: chordSymbol(root, quality),
    category: quality.category,
    voicings: Object.freeze(voicings)
  });
}

export const CHORD_LIBRARY = Object.freeze(CHORD_ROOTS.flatMap(root =>
  CHORD_QUALITIES.map(quality => buildChord(root, quality))
));

const CHORD_BY_ID = new Map(CHORD_LIBRARY.map(chord => [chord.id, chord]));

export function getChordById(chordId) {
  return CHORD_BY_ID.get(String(chordId || '')) || null;
}

export function getChord(root, quality) {
  return getChordById(`${String(root || '')}:${String(quality || '')}`);
}

export function getChordVoicing(chordId, voicingId = '') {
  const chord = getChordById(chordId);
  if (!chord) return null;
  const requested = String(voicingId || '');
  return chord.voicings.find(voicing => voicing.id === requested) || chord.voicings[0] || null;
}

export function chordsForRoot(root) {
  const id = String(root || '');
  return CHORD_LIBRARY.filter(chord => chord.root === id);
}

export function voicingText(frets) {
  return (frets || []).map(fret => /^x$/i.test(String(fret)) ? 'x' : String(fret)).join('');
}

export function notesForVoicing(voicing) {
  if (!voicing || voicing.tuning !== STANDARD_TUNING.id || !Array.isArray(voicing.frets)) return [];
  return voicing.frets.flatMap((fret, string) => {
    if (/^x$/i.test(String(fret))) return [];
    const numeric = Number(fret);
    if (!Number.isFinite(numeric) || numeric < 0) return [];
    return [{ string, fret: String(Math.trunc(numeric)), techniques: [] }];
  });
}

export function chordQualityById(qualityId) {
  return QUALITY_BY_ID.get(String(qualityId || '')) || null;
}

export function chordRootById(rootId) {
  return ROOT_BY_ID.get(String(rootId || '')) || null;
}
