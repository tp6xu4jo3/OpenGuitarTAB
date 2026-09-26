# Editor V3 Architecture

Editor V3 uses the V3 document as the authoritative music model. Rendering, playback, persistence, tools, and responsive layout all read from that document; DOM state is never promoted back into music data.

## Data model

`Song -> document -> measures -> events -> notes`

- `model.js` — schema, fractions, IDs, normalization, and document indexes.
- `migrate-v2.js` — one-way loading of older row-based songs into V3. Once a song enters the V3 Store, legacy `rows`, `rhythmRows`, and `rowMeasureCounts` are removed from the live song object.
- `store.js` — owns the current V3 document and emits typed `ChangeSet` updates.
- `commands.js` — pure music-data commands.
- `structure-commands.js` — pure system/measure structure commands.

V2 migration happens when an older song without a V3 document enters a `ScoreStore`. Generic metadata changes such as rename or publish must never reconstruct the V3 document from legacy row data.

## Controllers

- `controller.js` — composition root plus editor interaction coordination for Store, Clipboard, Tools, chord placement, technique selection, renderers, and ribbon integration.
- `tool-session.js` — click-only tool state machine and target-selection state.
- `technique-rules.js` — pure guitar-domain validation before Commands are dispatched.
- `rhythm-grid.js` — pure fractional-time transforms for triplet and 32nd-note regions plus the canonical editable-time projection.
- `structure-controller.js` — system/measure selection, menus, insertion, deletion, and structure drag/drop.
- `view-state.js` — the single owner of edit/score mode and presentation-only density state.
- `playback-controller.js` — playback UI state, lazy playback-index lifetime, playhead/progress, and event scheduling.
- `song-actions.js` — Save and Publish actions.

The production write path remains:

`UI -> Command -> Store -> ChangeSet -> Renderer`

Controller code may coordinate interactions, but it must not create a second data flow or mutate the document outside Commands/Store commits.

## Production rendering

- `renderer.js` — the production `SparseScoreRenderer`. It renders sparse V3 events directly, owns the visible TAB grid, adaptive visual rows, local measure updates, and a document-derived navigation index.
- `notation-renderer.js` — notation/technique/chord overlay rendering. A render pass builds one V3 document index and shares it with relation rendering.
- `relation-renderer.js` — SVG slide/tie/slur rendering. Relations are Note-ID based and use continuation segments when endpoints cross visual grids/systems.
- `layout.js` — shared adaptive layout for edit and score views. Normal layout wraps source systems responsively; compact score mode packs source-system segments by available width and notation complexity.

Sparse V3 is the only production renderer. The removed Dense Grid modules are not compatibility surfaces and must not be recreated.

Rendering is projection only. Tool targets may read stable IDs and fractional-time attributes emitted by the renderer, but Commands always resolve those targets against the Store document.

## ChangeSet invalidation scopes

`ChangeSet` separates music-data changes from visual-layout changes:

- `measures` — locally re-render the affected measure content and notation.
- `playback` — playback/music content changed. The controller marks the playback index dirty; the renderer does not decide playback invalidation.
- `layoutKind: metrics` — notation spacing complexity changed without changing editable time positions. Adaptive widths may be recomputed for the affected source system.
- `layoutKind: grid` — editable time positions changed, for example triplet or 32nd-note subdivision. The affected source system may need rebuilt visual rows and the navigation/playback timeline topology is dirty.
- `layoutKind: structure` — measure/system structure changed and a broader render is allowed.
- `document` — whole-document replacement/full invalidation.

Ordinary fret entry does not request `metrics` layout work unless the measure's actual spacing complexity changes. For example, changing one ordinary single-digit fret to another is a local measure + playback content update; a change that creates or removes a close pair of multi-digit frets can change layout metrics.

`layoutFrom` is a measure anchor. Notation uses it to identify the affected source system and redraws only that system's current visual segments rather than treating it as a full-document flag.

## Navigation

Keyboard navigation is derived from:

`document.measures -> editableTimesForMeasure()`

The renderer builds an ordered navigation index when grid/document structure changes. Arrow-key movement then uses that index directly; it must not rescan and sort every `.v3-column-target` in the DOM on each key press.

## Playback and audio

- `playback-index.js` — builds the playable timeline directly from V3 fractions and editable times.
- `playback-controller.js` — owns playback-index invalidation/rebuild policy, scheduling, progress, and playhead state.
- `audio-engine.js` — Web Audio guitar synthesis only.

Playback invalidation is driven by `ChangeSet.playback`, not render completion. Playback-index rebuilding is lazy: ordinary note-content edits may keep the existing timeline topology for navigation/progress until playback actually needs fresh event/note data, while grid/structure changes mark the timeline topology dirty immediately.

Playback reads V3 Events only; it never reads legacy slots or editor input DOM values.

## Tools and notation ownership

- `tools.js` — Tool Registry metadata and command factories.
- `tool-session.js` — interaction state only; it never writes song data.
- Note-local behavior belongs in `note.techniques`.
- Event-local notation belongs in `event.marks`.
- Grouped rhythm belongs in `measure.groups`.
- Note-to-note notation such as slide/tie/slur belongs in `document.relations`.

Artificial harmonics keep the actual fretted note in `note.fret`; harmonic metadata stores its own `touchFret`. Sweep symbols derive their span from the event's real notes. Fractional rhythm is authoritative in V3 and is scheduled directly by playback.

## Migration boundary

The only legacy direction is:

`older stored song -> migrate-v2 -> V3 Store`

After Store creation, there is no production V3-to-Dense-Grid compatibility projection and no legacy grid renderer. DOM or legacy row structures must never silently overwrite the V3 Store.

## Structural rule

Do not add runtime monkey patches, wrapper overrides, duplicate renderer/data paths, or modules named as emergency interception layers. Fix the owning module and preserve a single clear flow. In particular, removed Dense Grid modules such as `grid-renderer.js`, `grid-geometry.js`, `grid-navigation.js`, `input-controller.js`, `legacy-grid-compat.js`, and `presentation.js` must stay removed.

Avoid new cross-module `window.*` APIs when a direct module dependency fits. Existing global bridges are transition/application integration surfaces only and must not become a second source of truth.
