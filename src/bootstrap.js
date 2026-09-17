import { compactSong, deserializeSong } from './core/song-codec.js';
import { readLocalLibrary, writeLocalLibrary } from './storage/local-storage.js';

Object.assign(window, { compactSong, deserializeSong, readLocalLibrary, writeLocalLibrary });

const scripts = [
  './src/app-runtime.js',
  './src/app-editor.js',
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
