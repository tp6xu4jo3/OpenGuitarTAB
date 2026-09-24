import {
  CHORD_CATEGORIES,
  CHORD_LIBRARY,
  CHORD_ROOTS,
  chordsForRoot,
  voicingText
} from './chord-library.js';

export const RIBBON_SECTIONS = Object.freeze({
  TECHNIQUE: 'technique',
  CHORD: 'chord'
});

const VALID_SECTIONS = new Set(Object.values(RIBBON_SECTIONS));

export function nextRibbonSection(activeSection, requestedSection) {
  const requested = VALID_SECTIONS.has(requestedSection) ? requestedSection : null;
  if (!requested) return null;
  return activeSection === requested ? null : requested;
}

function button(className, label) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  return node;
}

export class EditorRibbon {
  constructor({
    toolDefinitions = [],
    chordLibrary = CHORD_LIBRARY,
    onToolSelect = null,
    onSectionChange = null
  } = {}) {
    this.toolDefinitions = [...toolDefinitions];
    this.chordLibrary = [...chordLibrary];
    this.onToolSelect = onToolSelect;
    this.onSectionChange = onSectionChange;
    this.activeSection = null;
    this.activeToolId = null;
    this.selectedChordRoot = CHORD_ROOTS[0]?.id || 'C';
    this.root = null;
    this.panel = null;
    this.chordChoices = null;
    this.tabButtons = new Map();
    this.sections = new Map();
    this.chordRootButtons = new Map();
    this.handleClick = this.handleClick.bind(this);
  }

  mountBefore(referenceNode) {
    if (this.root?.isConnected) return this.root;
    if (!referenceNode?.parentNode) return null;

    const root = document.createElement('section');
    root.className = 'editor-ribbon';
    root.id = 'editorRibbon';
    root.setAttribute('aria-label', '編輯器工具列');

    const tabs = document.createElement('div');
    tabs.className = 'editor-ribbon-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '編輯工具分類');
    tabs.append(
      this.createTab(RIBBON_SECTIONS.TECHNIQUE, '技巧'),
      this.createTab(RIBBON_SECTIONS.CHORD, '和弦')
    );

    const panel = document.createElement('div');
    panel.className = 'editor-ribbon-panel';
    panel.id = 'editorRibbonPanel';
    panel.hidden = true;
    panel.append(
      this.createTechniqueSection(),
      this.createChordSection()
    );

    root.append(tabs, panel);
    root.addEventListener('click', this.handleClick);
    referenceNode.before(root);
    this.root = root;
    this.panel = panel;
    this.sync();
    return root;
  }

  destroy() {
    this.root?.removeEventListener('click', this.handleClick);
    this.root?.remove();
    this.root = null;
    this.panel = null;
    this.chordChoices = null;
    this.tabButtons.clear();
    this.sections.clear();
    this.chordRootButtons.clear();
  }

  createTab(section, label) {
    const node = button('editor-ribbon-tab', label);
    node.dataset.ribbonSection = section;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-controls', `editorRibbon-${section}`);
    node.setAttribute('aria-selected', 'false');
    node.setAttribute('aria-expanded', 'false');
    this.tabButtons.set(section, node);
    return node;
  }

  createTechniqueSection() {
    const section = document.createElement('div');
    section.className = 'editor-ribbon-section editor-ribbon-techniques';
    section.id = `editorRibbon-${RIBBON_SECTIONS.TECHNIQUE}`;
    section.dataset.ribbonPanel = RIBBON_SECTIONS.TECHNIQUE;
    section.setAttribute('role', 'tabpanel');
    section.hidden = true;

    this.toolDefinitions.forEach(definition => {
      const tool = button('editor-tool-button', '');
      tool.dataset.editorTool = definition.id;
      tool.title = definition.hint || definition.label || definition.id;
      tool.setAttribute('aria-pressed', 'false');

      const glyph = document.createElement('span');
      glyph.className = 'editor-tool-glyph';
      glyph.textContent = definition.glyph || definition.label || definition.id;
      glyph.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'editor-tool-name';
      name.textContent = definition.label || definition.id;
      tool.append(glyph, name);
      section.appendChild(tool);
    });

    this.sections.set(RIBBON_SECTIONS.TECHNIQUE, section);
    return section;
  }

  createChordSection() {
    const section = document.createElement('div');
    section.className = 'editor-ribbon-section editor-ribbon-chords';
    section.id = `editorRibbon-${RIBBON_SECTIONS.CHORD}`;
    section.dataset.ribbonPanel = RIBBON_SECTIONS.CHORD;
    section.setAttribute('role', 'tabpanel');
    section.hidden = true;

    const roots = document.createElement('div');
    roots.className = 'editor-chord-roots';
    roots.setAttribute('aria-label', '和弦根音');
    CHORD_ROOTS.forEach(root => {
      const rootButton = button('editor-chord-root', root.label);
      rootButton.dataset.chordRoot = root.id;
      rootButton.setAttribute('aria-pressed', String(root.id === this.selectedChordRoot));
      this.chordRootButtons.set(root.id, rootButton);
      roots.appendChild(rootButton);
    });

    const choices = document.createElement('div');
    choices.className = 'editor-chord-choices';
    choices.setAttribute('aria-label', '和弦庫');
    this.chordChoices = choices;
    section.append(roots, choices);
    this.sections.set(RIBBON_SECTIONS.CHORD, section);
    this.renderChordChoices();
    return section;
  }

  renderChordChoices() {
    if (!this.chordChoices) return;
    const chords = this.chordLibrary === CHORD_LIBRARY
      ? chordsForRoot(this.selectedChordRoot)
      : this.chordLibrary.filter(chord => chord.root === this.selectedChordRoot);
    const fragment = document.createDocumentFragment();

    CHORD_CATEGORIES.forEach(category => {
      const categoryChords = chords.filter(chord => chord.category === category.id);
      if (!categoryChords.length) return;
      const group = document.createElement('div');
      group.className = 'editor-chord-category';
      group.dataset.chordCategory = category.id;

      const label = document.createElement('span');
      label.className = 'editor-chord-category-label';
      label.textContent = category.label;
      group.appendChild(label);

      const items = document.createElement('div');
      items.className = 'editor-chord-items';
      categoryChords.forEach(chord => {
        const voicing = chord.voicings[0];
        if (!voicing) return;
        const chordButton = button('editor-chord-button', chord.symbol);
        chordButton.draggable = true;
        chordButton.dataset.chordId = chord.id;
        chordButton.dataset.voicingId = voicing.id;
        chordButton.title = `${chord.symbol} · ${voicingText(voicing.frets)}`;
        chordButton.setAttribute('aria-label', `${chord.symbol}，指型 ${voicingText(voicing.frets)}，拖曳到譜面時間位置`);
        items.appendChild(chordButton);
      });
      group.appendChild(items);
      fragment.appendChild(group);
    });

    this.chordChoices.replaceChildren(fragment);
    this.syncChordRoots();
  }

  syncChordRoots() {
    this.chordRootButtons.forEach((rootButton, rootId) => {
      const active = rootId === this.selectedChordRoot;
      rootButton.classList.toggle('is-active', active);
      rootButton.setAttribute('aria-pressed', String(active));
    });
  }

  setChordRoot(rootId) {
    const requested = CHORD_ROOTS.some(root => root.id === rootId) ? rootId : this.selectedChordRoot;
    if (requested === this.selectedChordRoot) return this.selectedChordRoot;
    this.selectedChordRoot = requested;
    this.renderChordChoices();
    return this.selectedChordRoot;
  }

  handleClick(event) {
    const tab = event.target.closest?.('[data-ribbon-section]');
    if (tab && this.root?.contains(tab)) {
      event.preventDefault();
      this.toggle(tab.dataset.ribbonSection);
      return;
    }
    const root = event.target.closest?.('[data-chord-root]');
    if (root && this.root?.contains(root)) {
      event.preventDefault();
      this.setChordRoot(root.dataset.chordRoot);
      return;
    }
    const tool = event.target.closest?.('[data-editor-tool]');
    if (tool && this.root?.contains(tool)) {
      event.preventDefault();
      this.onToolSelect?.(tool.dataset.editorTool);
    }
  }

  toggle(section) {
    return this.setSection(nextRibbonSection(this.activeSection, section));
  }

  open(section) {
    if (!VALID_SECTIONS.has(section)) return this.activeSection;
    return this.setSection(section);
  }

  close() {
    return this.setSection(null);
  }

  setSection(section) {
    const next = VALID_SECTIONS.has(section) ? section : null;
    if (this.activeSection === next) return this.activeSection;
    const previous = this.activeSection;
    this.activeSection = next;
    this.sync();
    this.onSectionChange?.(next, previous);
    return this.activeSection;
  }

  setActiveTool(toolId) {
    this.activeToolId = toolId ? String(toolId) : null;
    this.root?.querySelectorAll('[data-editor-tool]').forEach(tool => {
      const active = tool.dataset.editorTool === this.activeToolId;
      tool.classList.toggle('is-active', active);
      tool.setAttribute('aria-pressed', String(active));
    });
  }

  setHidden(hidden) {
    if (this.root) this.root.hidden = Boolean(hidden);
  }

  state() {
    return {
      activeRibbon: this.activeSection,
      activeToolId: this.activeToolId,
      chordRoot: this.selectedChordRoot
    };
  }

  sync() {
    if (!this.root || !this.panel) return;
    const expanded = Boolean(this.activeSection);
    this.panel.hidden = !expanded;
    this.root.classList.toggle('is-expanded', expanded);
    this.root.dataset.activeRibbon = this.activeSection || '';

    this.tabButtons.forEach((tab, section) => {
      const active = section === this.activeSection;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('aria-expanded', String(active));
    });
    this.sections.forEach((panel, section) => {
      panel.hidden = section !== this.activeSection;
    });
    this.syncChordRoots();
    this.setActiveTool(this.activeToolId);
  }
}
