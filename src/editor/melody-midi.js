// Import Standard MIDI Files into beat-relative melody data owned by one arrangement.
// MIDI tempo is inspected only when importing; score BPM remains the single playback clock.
const MAX_MIDI_BYTES = 2_000_000;
const MAX_MELODY_NOTES = 20_000;

function midiError(message) { throw new Error(message); }

function readVariable(data, offset, end) {
  let value = 0;
  for (let i = 0; i < 4; i += 1) {
    if (offset >= end) midiError('MIDI資料不完整');
    const byte = data[offset++];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return [value, offset];
  }
  midiError('MIDI變長數值無效');
}

function readTrack(data, from, end, ticksPerBeat, index) {
  let offset = from;
  let ticks = 0;
  let runningStatus = 0;
  let trackName = `軌道 ${index + 1}`;
  const active = new Map();
  const notes = [];
  const channels = new Set();
  const tempoChanges = [];

  function finish(channel, pitch) {
    const key = `${channel}:${pitch}`;
    const starts = active.get(key);
    if (!starts?.length) return;
    const start = starts.shift();
    if (!starts.length) active.delete(key);
    if (ticks <= start.tick) return;
    notes.push({
      beat: start.tick / ticksPerBeat,
      duration: (ticks - start.tick) / ticksPerBeat,
      pitch,
      velocity: start.velocity,
      channel
    });
  }

  while (offset < end) {
    const delta = readVariable(data, offset, end);
    ticks += delta[0]; offset = delta[1];
    if (offset >= end) midiError('MIDI事件不完整');
    const raw = data[offset];
    let status;
    if (raw & 0x80) {
      status = raw;
      offset += 1;
      if (status < 0xf0) runningStatus = status;
      else runningStatus = 0;
    } else {
      if (!runningStatus) midiError('MIDI running status無效');
      status = runningStatus;
    }
    if (status === 0xff || status === 0xf0 || status === 0xf7) {
      if (status === 0xff) {
        if (offset >= end) midiError('MIDI Meta事件不完整');
        const kind = data[offset++];
        const [length, next] = readVariable(data, offset, end);
        offset = next;
        if (offset + length > end) midiError('MIDI Meta長度無效');
        if (kind === 0x03 && length > 0) {
          trackName = new TextDecoder().decode(data.subarray(offset, offset + length)).slice(0, 80);
        }
        if (kind === 0x51 && length === 3) {
          const microseconds = data[offset] * 65536 + data[offset + 1] * 256 + data[offset + 2];
          if (microseconds > 0) tempoChanges.push({ beat: ticks / ticksPerBeat, bpm: 60000000 / microseconds });
        }
        offset += length;
        if (kind === 0x2f) break;
      } else {
        const [length, next] = readVariable(data, offset, end);
        offset = next + length;
        if (offset > end) midiError('MIDI SysEx長度無效');
      }
      continue;
    }
    const type = status & 0xf0;
    const channel = status & 0x0f;
    const length = type === 0xc0 || type === 0xd0 ? 1 : 2;
    if (offset + length > end) midiError('MIDI音符事件不完整');
    const pitch = data[offset++];
    const velocity = length === 2 ? data[offset++] : 0;
    if (channel === 9) continue; // MIDI channel 10 is percussion, not melody.
    if (type === 0x90 && velocity > 0) {
      channels.add(channel);
      const key = `${channel}:${pitch}`;
      const starts = active.get(key) || [];
      starts.push({ tick: ticks, velocity });
      active.set(key, starts);
    } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
      finish(channel, pitch);
    }
  }
  // A missing note-off is not interpreted as a sustained note until infinity.
  return { index, name: trackName, notes: notes.sort((a,b)=>a.beat-b.beat || a.pitch-b.pitch), channels: [...channels], tempoChanges };
}

export function readMidiTracks(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  if (data.length > MAX_MIDI_BYTES) midiError('MIDI檔案超過2MB，請匯出單一旋律軌');
  if (data.length < 14) midiError('MIDI檔案太短');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = at => view.getUint16(at, false);
  const u32 = at => view.getUint32(at, false);
  const tag = at => String.fromCharCode(...data.subarray(at,at+4));
  if (tag(0) !== 'MThd' || u32(4) < 6) midiError('不是有效的MIDI檔案');
  const format = u16(8);
  const count = u16(10);
  const ppq = u16(12);
  if (format > 1 || !count || count > 64 || (ppq & 0x8000) || ppq < 1) {
    midiError('僅支援標準Type 0／1且使用PPQ時間軸的MIDI');
  }
  let offset = 8 + u32(4);
  const tracks = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 8 > data.length || tag(offset) !== 'MTrk') midiError('MIDI軌道格式無效');
    const size = u32(offset+4);
    const end = offset + 8 + size;
    if (end > data.length) midiError('MIDI軌道長度無效');
    tracks.push(readTrack(data, offset+8, end, ppq, i));
    offset = end;
  }
  const tempos = tracks.flatMap(track => track.tempoChanges).sort((a, b) => a.beat - b.beat);
  // Standard MIDI defaults to 500000 microseconds per quarter note (120 BPM).
  const tempoStatus = !tempos.length ? 'implicit-default'
    : tempos[0].beat > 0 || tempos.some(change => Math.abs(change.bpm - tempos[0].bpm) > 0.01)
      ? 'variable' : 'constant';
  const midiBpm = tempoStatus === 'implicit-default' ? 120
    : tempoStatus === 'constant' ? Math.round(tempos[0].bpm * 1000) / 1000 : null;
  return tracks.filter(track => track.notes.length).map(({ tempoChanges, ...track }) => ({
    ...track, midiBpm, tempoStatus
  }));
}

export const MIDI_BEAT_SCALES = [0.5, 1, 2];

export function validateMidiBeatScale(value) {
  if (value == null) return undefined;
  const scale = Number(value);
  if (!MIDI_BEAT_SCALES.includes(scale)) midiError('midiBeatScale僅允許0.5、1、2');
  return scale;
}

// One source MIDI beat is converted into this many SCORE beats at import time.
// After import, the score BPM owns playback speed; changing BPM must never re-scale the notes.
export function resolveMidiBeatScale({ markedScale, midiBpm, scoreBpm } = {}) {
  const existing = validateMidiBeatScale(markedScale);
  if (existing !== undefined) return { scale: existing, reason: 'marked' };
  const midi = Number(midiBpm);
  const score = Number(scoreBpm);
  if (Number.isFinite(midi) && midi > 0 && Number.isFinite(score) && score > 0) {
    const ratio = midi / score;
    for (const [expectedRatio, scale] of [[2, 0.5], [1, 1], [0.5, 2]]) {
      if (Math.abs(ratio / expectedRatio - 1) <= 0.035) return { scale, reason: 'auto' };
    }
  }
  return { scale: null, reason: 'ambiguous' };
}

export function melodyFromMidiTrack(track, fileName = '', beatScale = 1) {
  const scale = validateMidiBeatScale(beatScale);

  if (!track?.notes?.length) midiError('MIDI沒有可播放的旋律音符');
  if (track.notes.length > MAX_MELODY_NOTES) midiError('旋律音符過多');
  const notes = track.notes
    .filter(note => note.duration > 0 && note.pitch >= 0 && note.pitch <= 127)
    .map(({beat,duration,pitch,velocity}) => ({
      beat: Math.round(beat * scale * 1000000) / 1000000,
      duration: Math.max(0.000001, Math.round(duration * scale * 1000000) / 1000000),
      pitch,
      velocity
    }));
  if (!notes.length) midiError('MIDI沒有有效音符');
  return { version: 1, format: 'midi', sourceName: String(fileName).slice(0, 120), notes };
}

export function normalizeMelody(input) {
  if (input == null) return undefined;
  if (input?.version !== 1 || input?.format !== 'midi' || !Array.isArray(input.notes) || !input.notes.length || input.notes.length > MAX_MELODY_NOTES) {
    midiError('旋律資料格式無效');
  }
  const notes = input.notes.map(note => {
    const beat = Number(note?.beat);
    const duration = Number(note?.duration);
    const pitch = Number(note?.pitch);
    const velocity = Number(note?.velocity);
    if (!Number.isFinite(beat) || beat < 0 || beat > 100000 || !Number.isFinite(duration) || duration <= 0 || duration > 1000
      || !Number.isInteger(pitch) || pitch < 0 || pitch > 127
      || !Number.isInteger(velocity) || velocity < 1 || velocity > 127) {
      midiError('旋律音符資料無效');
    }
    return { beat, duration, pitch, velocity };
  });
  notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
  return { version: 1, format: 'midi', sourceName: String(input.sourceName || '').slice(0, 120), notes };
}
