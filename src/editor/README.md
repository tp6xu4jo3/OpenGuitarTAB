# Editor V3 Architecture

Editor V3 uses the V3 document as the authoritative music model. UI grids, playback, persistence, and compatibility rows are views or projections of that model; they must not overwrite the document implicitly.

## Data model

`Song -> document -> measures -> events -> notes`

- `model.js` — schema, fractions, IDs, normalization, document indexes.
- `migrate-v2.js` — one-way V2 loading/migration plus explicit legacy projection for the current grid UI.
- `store.js` — owns the current V3 document and emits `ChangeSet` updates.
- `commands.js` — pure music-data commands.
- `structure-commands.js` — pure system/measure structure commands.

V2 migration happens when a song without a V3 document enters a `ScoreStore`. Generic metadata changes such as rename or publish must never trigger V2 rows -> V3 reconciliation.

## Controllers

- `controller.js` — composition root for Store, Clipboard, Tools, and renderer factory. Keep this file orchestration-only.
- `input-controller.js` — note input and keyboard interaction. Input dispatches V3 commands first; compatibility rows are only updated for the current grid view.
- `structure-controller.js` — row/system/measure selection, menu, insertion, deletion, and drag/drop.
- `view-state.js` — edit/score/preview mode state.
- `playback-controller.js` — playback UI state and event scheduling.
- `song-actions.js` — editor Save and Publish actions.

## Rendering and layout

- `grid-renderer.js` — current production TAB grid, rhythm notation, keyboard navigation, and row metrics.
- `renderer.js` — sparse V3 renderer for the full V3 visual cutover.
- `relation-renderer.js` — SVG relation layer for slide/tie/slur-style relations.
- `layout.js` — pure V3 system and time layout helpers.
- `responsive-score-layout.js` — responsive/score presentation rules around the production grid.
- `presentation.js` — note backgrounds and density fitting.

Rendering must not become a data source. DOM scanning is not a persistence path.

## Playback and audio

- `playback-index.js` — builds an event timeline directly from V3 fractions.
- `playback-controller.js` — schedules timeline entries and controls playhead/progress.
- `audio-engine.js` — Web Audio guitar synthesis only.

Playback must read V3 Events, never legacy slots or `.note-input` values.

## Tools and notation

- `tools.js` — Tool Registry and drag payloads.
- note-local behavior belongs in `note.techniques`.
- event-local notation belongs in `event.marks`.
- grouped rhythm belongs in `measure.groups`.
- note-to-note notation such as slide/tie/slur belongs in `document.relations`.

New notation should be implemented through Commands + Renderer/Relation Renderer, not through a new patch script.

## Compatibility boundary

Legacy `rows`, `rhythmRows`, and `rowMeasureCounts` currently exist only so the production grid and older stored songs remain usable during the sparse-renderer cutover.

Allowed direction:

`V2 stored song -> migrate-v2 -> V3 Store`

`V3 Store -> explicit projection -> current grid compatibility view`

Disallowed direction after Store creation:

`DOM or generic legacy rows -> silently overwrite V3 Store`

When the sparse renderer fully replaces the current grid, the compatibility projection can be removed without changing the music model, commands, playback, or persistence architecture.
