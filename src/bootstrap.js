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
import { installAudioEngine } from './editor/audio-engine.js';
import { installChordDragController } from './editor/chord-drag-controller.js';
import { installEditorV3 } from './editor/controller.js';
import { ensureSongDocumentV3 } from './editor/migrate-v2.js';
import { createBlankDocumentV3 } from './editor/model.js';
import { installPlaybackController } from './editor/playback-controller.js';
import { installEditorSongActions } from './editor/song-actions.js';
import { installStructureController } from './editor/structure-controller.js';
import { installViewState } from './editor/view-state.js';
import { installSongImport } from './library/song-import.js';
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
  APP_CONFIG,
  createBlankDocumentV3,
  ensureSongDocumentV3
});

const RUNTIME_SCRIPTS = [
  './src/app-runtime.js',
  './src/app-auth.js'
];

const APP_SCRIPTS = [
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

void cloudApi.catalog().catch(() => null);

await loadClassicScriptsInOrder(RUNTIME_SCRIPTS);
installViewState();
installAudioEngine();
installPlaybackController();
installEditorSongActions();
installSongImport();
installEditorV3();
installChordDragController();
installStructureController();
await loadClassicScriptsInOrder(APP_SCRIPTS);
