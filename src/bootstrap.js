import { compactSong, deserializeSong } from './core/song-codec.js';
import { readLocalLibrary, writeLocalLibrary } from './storage/local-storage.js';

Object.assign(window, { compactSong, deserializeSong, readLocalLibrary, writeLocalLibrary });

const scripts = [
  './src/app-runtime.js',
  './src/app-editor-core.js',
  './src/app-row-layout.js',
  './src/app-editor-stability.js',
  './src/app-editor-modules.js',
  './src/app-editor-insert-zones.js',
  './src/app-editor-row-controls.js',
  './src/app-audio.js',
  './src/app-row-playback.js',
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
