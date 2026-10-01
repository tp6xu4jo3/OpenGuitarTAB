from pathlib import Path

path = Path('tests/ui-layout-regression.test.mjs')
text = path.read_text(encoding='utf-8')
old = "assert.match(editorCss,/\\.v3-rhythm-beam,\\.v3-rhythm-flag\\{[^}]*height:var\\(--v3-rhythm-beam-thickness\\)/s,'rhythm beams and beamlets must use the heavier beam thickness');"
new = "assert.match(editorCss,/\\.v3-rhythm-beam,\\.v3-rhythm-hook\\{[^}]*height:var\\(--v3-rhythm-beam-thickness\\)/s,'rhythm beams and partial beam hooks must use the heavier beam thickness');\nassert.match(editorCss,/\\.v3-rhythm-flag\\{[^}]*height:var\\(--v3-rhythm-stroke\\)[^}]*rotate\\(-38deg\\)/s,'isolated note flags should use the stem stroke weight and angle away from the stem');"
if old not in text:
    raise SystemExit('ui rhythm assertion anchor not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
