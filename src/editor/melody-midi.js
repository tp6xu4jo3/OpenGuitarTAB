// Import Standard MIDI Files into beat-relative melody data owned by one arrangement.
// Tempo events are intentionally not imported: the score BPM is the single playback tempo.
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
  return { index, name: trackName, notes: notes.sort((a,b)=>a.beat-b.beat || a.pitch-b.pitch), channels: [...channels] };
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
  return tracks.filter(track => track.notes.length);
}

export function melodyFromMidiTrack(track, fileName = '') {
  if (!track?.notes?.length) midiError('MIDI沒有可播放的旋律音符');
  if (track.notes.length > MAX_MELODY_NOTES) midiError('旋律音符過多');
  const notes = track.notes
    .filter(note => note.duration > 0 && note.pitch >= 0 && note.pitch <= 127)
    .map(({beat,duration,pitch,velocity}) => ({
      beat: Math.round(beat * 1000000) / 1000000,
      duration: Math.round(duration * 1000000) / 1000000,
      pitch,
      velocity
    }));
  if (!notes.length) midiError('MIDI沒有有效音符');
  return { version: 1, format: 'midi', sourceName: String(fileName).slice(0, 120), notes };
}
