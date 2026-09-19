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

const scripts = [
  './src/app-runtime.js',
  './src/app-auth.js',
  './src/app-editor-core.js',
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
  './src/app-playback.js',
  './src/app-library.js',
  './src/app-catalog.js'
];

for (const src of scripts) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`無法載入 ${src}`));
    document.body.appendChild(script);
  });
}
