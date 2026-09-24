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
- `tool-session.js` — click-only tool state machine. It owns `idle -> selected -> selecting target -> commit -> idle` state and the Note/Column/NotePair/Range target shapes.
- `technique-rules.js` — pure guitar-domain validation for harmonics, chord sweeps, merged arcs, slides, and rhythm-range constraints before Commands are dispatched.
- `rhythm-grid.js` — pure fractional-time transforms for regional triplet (3:2) and 32nd subdivisions; empty 32nd positions persist as rhythm anchors while triplet slots remain sparse group data.
- `input-controller.js` — note input orchestration. It dispatches V3 note commands and delegates navigation/presentation work to dedicated modules.
- `grid-navigation.js` — arrow-only score navigation over real fractional time positions. Enter is consumed but never moves the cursor.
- `legacy-grid-compat.js` — the only production-grid compatibility boundary for legacy rows, rhythm rows, row counts, and explicit V3 -> V2 projection.
- `structure-controller.js` — row/system/measure selection, menu, insertion, deletion, and structure drag/drop.
- `view-state.js` — the single owner of edit/score mode switching plus presentation-only score density (normal/compact). Density changes never modify the song document.
- `playback-controller.js` — the single owner of playback UI state, play-button behavior, progress index, and event scheduling.
- `song-actions.js` — editor Save and Publish actions.

Ordinary note entry is a local Store/DOM update and never triggers adaptive reflow on blur. Layout invalidation is typed: `metrics` recomputes adaptive widths for technique/mark/relation notation, `grid` rebuilds only visual rows belonging to the affected source system when editable time positions change, and `structure` is reserved for document/system structure changes. `layoutFrom` is a measure anchor, never a boolean alias for full `renderRows`.

Technique tools are click-only. Clicking a tool activates it, a successful target command returns the session to idle, invalid targets keep the tool active, and Escape or clicking the active tool again cancels it. Structure drag/drop remains a separate editor interaction.

## Rendering and layout

- `grid-renderer.js` — current production TAB grid and adaptive visual-system composition. Each adaptive wrap is rendered as a first-class visual row; source-system identity remains attached to the row so responsive wrapping never mutates song structure. It does not own keyboard navigation or projection rules.
- `grid-geometry.js` — shared measure-width and time-position geometry used by grid rendering, playback, structure UI, and presentation.
- `renderer.js` — sparse V3 renderer for the full V3 visual cutover.
- `relation-renderer.js` — SVG relation layer for slide/tie/slur-style relations. Relations are Note-ID based; adaptive line/system breaks render continuation segments at grid edges instead of storing or connecting stale screen coordinates.
- `layout.js` — the shared adaptive V3 layout engine for edit and score views. Normal layout balances four-measure wraps so a 3+1 orphan becomes 2+2; compact score mode greedily packs source-system segments by available width and notation complexity, so the visual measure count is not a fixed 4/8 preset.
- `presentation.js` — note backgrounds and density fitting.

Rendering must not become a data source. DOM scanning is not a persistence path. Tool targets may read stable IDs and fractional time attributes projected by the renderer, but commands always resolve against the Store document.

`ChangeSet.measures` drives local notation updates. `ChangeSet.layoutFrom` anchors layout work at a measure and `ChangeSet.layoutKind` defines its scope. Harmonic, strum/arpeggio, slide, tie, slur, and their deletion paths use `metrics`: if visual grouping is unchanged, only adaptive measure widths and local notation are refreshed; if grouping changes, only that source system's visual rows are rebuilt. Triplet/32nd subdivision, tuplet-group grid changes, and measure content replacement use `grid` and rebuild only that source system. Structural edits use `structure` and may request a full render.

## Playback and audio

- `playback-index.js` — builds an event timeline directly from V3 fractions.
- `playback-controller.js` — schedules timeline entries and controls playhead/progress.
- `audio-engine.js` — Web Audio guitar synthesis only.

Playback must read V3 Events, never legacy slots or `.note-input` values.

## Tools and notation

- `tools.js` — Tool Registry metadata and command factories. It contains no drag payload transport.
- `tool-session.js` — interaction state only; it never writes song data.
- note-local behavior belongs in `note.techniques`. Artificial harmonics keep the actual fretted note in `note.fret`; the technique stores only its own `touchFret` metadata.
- event-local notation belongs in `event.marks`. Sweep symbols derive their vertical span from the event's actual note strings, never from all six UI inputs in the column.
- grouped rhythm belongs in `measure.groups`.
- note-to-note notation such as slide/tie/slur belongs in `document.relations`.

New notation should be implemented through Commands + Renderer/Relation Renderer, not through a new patch script. Technique graphics stay display-only and noninteractive; stable markers below the sixth string are the selection/deletion surface for note techniques, event marks, groups, and relations.

## Compatibility boundary

Legacy `rows`, `rhythmRows`, and `rowMeasureCounts` currently exist only so the production grid and older stored songs remain usable during the sparse-renderer cutover.

Allowed direction:

`V2 stored song -> migrate-v2 -> V3 Store`

`V3 Store -> explicit projection -> current grid compatibility view`

Disallowed direction after Store creation:

`DOM or generic legacy rows -> silently overwrite V3 Store`

When the sparse renderer fully replaces the current grid, the compatibility projection can be removed without changing the music model, commands, playback, or persistence architecture.

Fractional rhythm editing is authoritative in V3: triplet and 32nd positions are stored as reduced fractions, rendered as dynamic inputs, and scheduled directly by Playback. The legacy 1/16 projection remains compatibility-only and is not used to quantize fractional rhythm.

## Structural rule

Compatibility code may translate between the current grid surface and V3, but it must stay inside named compatibility modules. App/library scripts must not reintroduce DOM-to-song reads, duplicate playback state, or duplicate score-mode handlers. Do not add runtime monkey patches, wrapper overrides, duplicate geometry parsers, or cross-module `window.*` calls when a direct module dependency exists. The production editor remains Store -> Command -> ChangeSet -> Render; DOM state is never promoted back to authoritative music data.
