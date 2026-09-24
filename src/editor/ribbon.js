export const RIBBON_SECTIONS = Object.freeze({
  TECHNIQUE: 'technique',
  CHORD: 'chord'
});

export const CHORD_CATEGORY_SHELLS = Object.freeze([
  { id: 'major', label: '大調' },
  { id: 'minor', label: '小調' },
  { id: 'dominant', label: '屬和弦' },
  { id: 'suspended', label: '掛留' },
  { id: 'other', label: '其他' }
]);

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
    onToolSelect = null,
    onSectionChange = null
  } = {}) {
    this.toolDefinitions = [...toolDefinitions];
    this.onToolSelect = onToolSelect;
    this.onSectionChange = onSectionChange;
    this.activeSection = null;
    this.activeToolId = null;
    this.root = null;
    this.panel = null;
    this.tabButtons = new Map();
    this.sections = new Map();
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
    this.tabButtons.clear();
    this.sections.clear();
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

    const categories = document.createElement('div');
    categories.className = 'editor-chord-category-shells';
    categories.setAttribute('aria-label', '和弦分類');
    CHORD_CATEGORY_SHELLS.forEach(category => {
      const item = document.createElement('span');
      item.className = 'editor-chord-category-shell';
      item.dataset.chordCategory = category.id;
      item.textContent = category.label;
      categories.appendChild(item);
    });
    section.appendChild(categories);
    this.sections.set(RIBBON_SECTIONS.CHORD, section);
    return section;
  }

  handleClick(event) {
    const tab = event.target.closest?.('[data-ribbon-section]');
    if (tab && this.root?.contains(tab)) {
      event.preventDefault();
      this.toggle(tab.dataset.ribbonSection);
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
    return { activeRibbon: this.activeSection, activeToolId: this.activeToolId };
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
    this.setActiveTool(this.activeToolId);
  }
}
