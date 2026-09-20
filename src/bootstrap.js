import { compactSong, deserializeSong } from './core/song-codec.js';
import {
  songOwner,
  songWasPublished,
  songIsPublic,
  canEditSong,
  canUnlistSong,
  canDeleteSong
} from './core/song-permissions.js';
import { cloudApi } from './services/cloud-api.js';
import { APP_CONFIG } from './config/app-config.js';

Object.assign(window, {
  compactSong,
  deserializeSong,
  songOwner,
  songWasPublished,
  songIsPublic,
  canEditSong,
  canUnlistSong,
  canDeleteSong,
  cloudApi,
  APP_CONFIG
});

const RUNTIME_SCRIPTS = [
  './src/app-runtime.js',
  './src/app-auth.js',
  './src/app-editor-core.js'
];

const EDITOR_SCRIPTS = [
  './src/app-note-backgrounds.js',
  './src/app-row-layout.js',
  './src/app-measure-lines.js',
  './src/app-editor-stability.js',
  './src/app-editor-modules.js',
  './src/app-editor-insert-zones.js',
  './src/app-editor-row-controls.js',
  './src/app-audio.js',
  './src/app-row-playback.js',
  './src/app-adaptive-measures.js',
  './src/app-score-layout.js',
  './src/app-density-fit-v2.js',
  './src/app-playback.js'
];

const APP_SCRIPTS = [
  ...RUNTIME_SCRIPTS,
  ...EDITOR_SCRIPTS,
  './src/app-library.js',
  './src/app-catalog.js'
];

function loadClassicScriptsInOrder(sources) {
  const loads = sources.map(src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`無法載入 ${src}`));
    document.body.appendChild(script);
  }));
  return Promise.all(loads);
}

// Start the slowest public request while the browser fetches the remaining app scripts.
// cloudApi.catalog() deduplicates the later catalog request made by app-catalog.js.
void cloudApi.catalog().catch(() => null);

// Dynamically-created classic scripts are async by default. Setting async=false keeps
// execution order while allowing the browser to fetch all files in parallel.
await loadClassicScriptsInOrder(APP_SCRIPTS);
