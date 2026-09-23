import { compactSong, deserializeSong } from './core/song-codec.js';
import {
  songOwner,
  songWasPublished,
  songIsPublic,
  canEditSong,
  canUnlistSong,
  canDeleteSong
} from './core/song-permissions.js';
import { APP_CONFIG } from './config/app-config.js';
import { installEditorV3 } from './editor/controller.js';
import { cloudApi } from './services/cloud-api.js';

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
  './src/app-editor-drag-grip.js',
  './src/app-editor-performance.js',
  './src/app-audio.js',
  './src/app-row-playback.js',
  './src/app-adaptive-measures.js',
  './src/app-score-layout.js',
  './src/app-density-fit-v2.js',
  './src/app-playback.js',
  './src/app-editor-drop-guard.js',
  './src/app-editor-hotpath.js'
];

const APP_SCRIPTS = [
  ...RUNTIME_SCRIPTS,
  ...EDITOR_SCRIPTS,
  './src/app-library.js',
  './src/app-catalog.js',
  './src/app-source-ui.js'
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

// Classic compatibility scripts still load in their historical order while Editor V3 owns
// the score document, commands, clipboard and future tool/renderer pipeline.
await loadClassicScriptsInOrder(APP_SCRIPTS);
installEditorV3();
