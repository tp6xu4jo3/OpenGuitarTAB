import crypto from 'node:crypto';
import { songFileName } from '../api/index.js';

const DEFAULT_SOURCE_FOLDER_ID = '1KiyhdXnmfyyEkIbNQDEyI_NEXJlmRxg7';
const RESERVED_JSON_NAMES = new Set(['index.json', 'artists.json', 'permissions.json']);
const CONCURRENCY = 5;

function required(value, name) {
  const clean = String(value || '').trim();
  if (!clean) throw new Error(`${name}_REQUIRED`);
  return clean;
}

function normalizedTitle(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function noteCount(song) {
  const measures = song?.document?.measures;
  if (!Array.isArray(measures) || !measures.length) return 0;
  let count = 0;
  for (const measure of measures) {
    for (const event of Array.isArray(measure?.events) ? measure.events : []) {
      count += Array.isArray(event?.notes) ? event.notes.length : 0;
    }
  }
  return count;
}

function documentHash(song) {
  return crypto.createHash('sha256').update(JSON.stringify(song?.document ?? null)).digest('hex');
}

function chooseSource(song, candidates) {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  const scored = candidates.map(candidate => {
    let score = 0;
    if (normalizedTitle(song.artist) && normalizedTitle(song.artist) === normalizedTitle(candidate.song.artist)) score += 4;
    if (normalizedTitle(song.album) && normalizedTitle(song.album) === normalizedTitle(candidate.song.album)) score += 3;
    if (Number(song.tempo) && Number(song.tempo) === Number(candidate.song.tempo)) score += 1;
    if (Number(song.capo) === Number(candidate.song.capo)) score += 1;
    return { candidate, score };
  }).sort((a, b) => b.score - a.score);
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].candidate;
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`DRIVE_TOKEN_FAILED:${payload.error || response.status}`);
  return payload.access_token;
}

function createDrive(accessToken) {
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
    });
    if (response.ok) return response;
    throw new Error(`DRIVE_${options.method || 'GET'}_${response.status}:${(await response.text()).slice(0, 240)}`);
  }

  return {
    async listJson(folderId) {
      const files = [];
      let pageToken = '';
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed = false and mimeType = 'application/json'`,
          fields: 'nextPageToken,files(id,name,modifiedTime,size)',
          pageSize: '1000'
        });
        if (pageToken) params.set('pageToken', pageToken);
        const payload = await (await request(`https://www.googleapis.com/drive/v3/files?${params}`)).json();
        files.push(...(payload.files || []));
        pageToken = payload.nextPageToken || '';
      } while (pageToken);
      return files.filter(file => !RESERVED_JSON_NAMES.has(file.name));
    },

    async readJson(fileId) {
      return (await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`)).json();
    },

    async writeJson(fileId, value) {
      return (await request(
        `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime,size`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: `${JSON.stringify(value, null, 2)}\n`
        }
      )).json();
    },

    async rename(fileId, name) {
      return (await request(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,size`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ name })
        }
      )).json();
    }
  };
}

async function mapConcurrent(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, items.length)) }, () => run()));
  return results;
}

export async function repairPublicScores({
  publicFolderId = process.env.PUBLIC_DRIVE_FOLDER_ID,
  sourceFolderId = process.env.AI_COMPARE_DRIVE_FOLDER_ID || DEFAULT_SOURCE_FOLDER_ID,
  clientId = process.env.GOOGLE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET,
  refreshToken = process.env.GOOGLE_REFRESH_TOKEN
} = {}) {
  const config = {
    publicFolderId: required(publicFolderId, 'PUBLIC_DRIVE_FOLDER_ID'),
    sourceFolderId: required(sourceFolderId, 'AI_COMPARE_DRIVE_FOLDER_ID'),
    clientId: required(clientId, 'GOOGLE_CLIENT_ID'),
    clientSecret: required(clientSecret, 'GOOGLE_CLIENT_SECRET'),
    refreshToken: required(refreshToken, 'GOOGLE_REFRESH_TOKEN')
  };
  const drive = createDrive(await getAccessToken(config));
  const [publicFiles, sourceFiles] = await Promise.all([
    drive.listJson(config.publicFolderId),
    drive.listJson(config.sourceFolderId)
  ]);

  const sourceEntries = await mapConcurrent(sourceFiles, async file => ({ file, song: await drive.readJson(file.id) }));
  const sourceByName = new Map();
  for (const entry of sourceEntries) {
    const key = normalizedTitle(entry.song?.name);
    if (!key) continue;
    if (!sourceByName.has(key)) sourceByName.set(key, []);
    sourceByName.get(key).push(entry);
  }

  const publicEntries = await mapConcurrent(publicFiles, async file => {
    const song = await drive.readJson(file.id);
    return {
      file,
      song,
      initialNoteCount: noteCount(song),
      initialDocumentHash: documentHash(song)
    };
  });

  const summary = {
    publicCount: publicEntries.length,
    sourceJsonCount: sourceEntries.length,
    initialEmpty: [],
    repairedFromSource: [],
    unresolvedEmpty: [],
    aiRenamed: [],
    fileRenamed: [],
    ambiguousMatches: [],
    validationErrors: []
  };

  for (const entry of publicEntries) {
    const { file } = entry;
    const song = structuredClone(entry.song);
    const nameKey = normalizedTitle(song?.name);
    const candidates = sourceByName.get(nameKey) || [];
    const source = chooseSource(song, candidates);
    let contentChanged = false;
    let replacementSource = null;

    if (entry.initialNoteCount === 0) {
      summary.initialEmpty.push({ id: file.id, name: song?.name || '', fileName: file.name });
      if (source && noteCount(source.song) > 0) {
        song.document = structuredClone(source.song.document);
        contentChanged = true;
        replacementSource = source;
        summary.repairedFromSource.push({
          id: file.id,
          name: song?.name || '',
          sourceFileId: source.file.id,
          sourceFileName: source.file.name,
          sourceNotes: noteCount(source.song)
        });
      } else {
        summary.unresolvedEmpty.push({ id: file.id, name: song?.name || '', fileName: file.name });
      }
    }

    if (candidates.length > 1 && !source) {
      summary.ambiguousMatches.push({
        id: file.id,
        name: song?.name || '',
        candidates: candidates.map(item => item.file.name)
      });
    }

    if (candidates.length && song.arrangementName !== 'AI編譜') {
      song.arrangementName = 'AI編譜';
      song.updatedAt = Date.now();
      contentChanged = true;
      summary.aiRenamed.push({ id: file.id, name: song?.name || '' });
    }

    if (contentChanged) await drive.writeJson(file.id, song);

    const targetName = songFileName(song);
    if (file.name !== targetName) {
      await drive.rename(file.id, targetName);
      summary.fileRenamed.push({ id: file.id, from: file.name, to: targetName });
    }

    entry.expectedSong = song;
    entry.replacementSource = replacementSource;
  }

  const finalFiles = await drive.listJson(config.publicFolderId);
  const finalById = new Map(finalFiles.map(file => [file.id, file]));
  await mapConcurrent(publicEntries, async entry => {
    const finalFile = finalById.get(entry.file.id);
    if (!finalFile) {
      summary.validationErrors.push({ id: entry.file.id, error: 'FILE_MISSING_AFTER_REPAIR' });
      return;
    }
    let finalSong;
    try {
      finalSong = await drive.readJson(entry.file.id);
    } catch (error) {
      summary.validationErrors.push({ id: entry.file.id, error: `INVALID_JSON:${error.message}` });
      return;
    }

    const expectedName = songFileName(finalSong);
    if (finalFile.name !== expectedName) {
      summary.validationErrors.push({ id: entry.file.id, error: 'FILENAME_MISMATCH', actual: finalFile.name, expected: expectedName });
    }

    if (entry.replacementSource) {
      if (documentHash(finalSong) !== documentHash(entry.replacementSource.song)) {
        summary.validationErrors.push({ id: entry.file.id, error: 'REPLACEMENT_DOCUMENT_MISMATCH' });
      }
    } else if (documentHash(finalSong) !== entry.initialDocumentHash) {
      summary.validationErrors.push({ id: entry.file.id, error: 'UNINTENDED_DOCUMENT_CHANGE' });
    }

    if ((sourceByName.get(normalizedTitle(finalSong.name)) || []).length && finalSong.arrangementName !== 'AI編譜') {
      summary.validationErrors.push({ id: entry.file.id, error: 'AI_NAME_NOT_APPLIED' });
    }
  });

  const finalEmpty = [];
  for (const entry of publicEntries) {
    const finalSong = await drive.readJson(entry.file.id);
    if (noteCount(finalSong) === 0) finalEmpty.push({ id: entry.file.id, name: finalSong.name || '' });
  }
  summary.finalEmpty = finalEmpty;
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await repairPublicScores();
  console.log(JSON.stringify(summary, null, 2));
  if (summary.validationErrors.length) process.exitCode = 1;
}
