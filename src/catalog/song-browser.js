import { aggregateCatalogWorks } from './work-model.js';
import { artistProfileFor } from './artist-profiles.js';

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function collectArtists(works = []) {
  return [...new Set(works.map(work => String(work?.artist || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export function filterWorks(works = [], { query = '', artist = '' } = {}) {
  const q = normalizeText(query);
  const selectedArtist = String(artist || '').trim();
  return works.filter(work => {
    if (selectedArtist && String(work?.artist || '').trim() !== selectedArtist) return false;
    if (!q) return true;
    const arrangementText = (work?.arrangements || [])
      .map(item => [item.source, item.uploadedBy, item.playStyle].filter(Boolean).join(' '))
      .join(' ');
    return normalizeText([work?.name, work?.artist, work?.album, arrangementText].filter(Boolean).join(' ')).includes(q);
  });
}

export function worksFromSongs(songs = []) {
  const metadata = songs.map(song => ({
    ...song,
    owner: String(song?._opentab?.owner || song?.owner || ''),
    uploadedBy: String(song?._opentab?.uploadedBy || song?.uploadedBy || song?._opentab?.owner || ''),
    public: song?._opentab?.public === true,
    _driveFileId: String(song?._driveFileId || ''),
    _driveFileName: String(song?._driveFileName || ''),
    _driveModifiedTime: String(song?._driveModifiedTime || song?.updatedAt || '')
  }));
  return aggregateCatalogWorks(metadata);
}

function playStyleLabel(value) {
  if (value === 'fingerstyle') return '指彈';
  if (value === 'chord') return '和弦';
  return '未設定';
}

function difficultyLabel(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 5 ? `難度 ${Math.round(number)}` : '難度 -';
}

function createElement(tag, className, text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function artistInitial(artist) {
  const clean = String(artist || '').trim();
  return clean ? [...clean][0].toUpperCase() : '？';
}

function installHorizontalWheel(rail) {
  rail.addEventListener('wheel', event => {
    if (rail.scrollWidth <= rail.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    rail.scrollLeft += event.deltaY;
  }, { passive: false });
}

function createNextButton(label, rail) {
  const button = createElement('button', 'song-browser-next');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.innerHTML = '<span aria-hidden="true">›</span>';
  button.addEventListener('click', () => {
    rail.scrollBy({ left: Math.max(260, rail.clientWidth * 0.82), behavior: 'smooth' });
  });
  return button;
}

export class SongBrowser {
  constructor({ container, searchInput = null, countElement = null, emptyText = '找不到符合條件的曲譜。', renderArrangementActions = null } = {}) {
    if (!container) throw new Error('SONG_BROWSER_CONTAINER_REQUIRED');
    this.container = container;
    this.searchInput = searchInput;
    this.countElement = countElement;
    this.emptyText = emptyText;
    this.renderArrangementActions = renderArrangementActions;
    this.works = [];
    this.errorText = '';
    this.activeArtist = '';
    this.expandedWorkId = null;

    this.container.classList.remove('song-card-grid');
    this.container.classList.add('song-browser-rail');

    this.songHeading = createElement('div', 'song-browser-section-heading');
    this.songHeading.appendChild(createElement('h3', '', '曲譜'));
    this.songShell = createElement('div', 'song-browser-rail-shell song-browser-song-shell');
    this.container.before(this.songHeading, this.songShell);
    this.songShell.appendChild(this.container);
    this.songNext = createNextButton('向右瀏覽更多曲譜', this.container);
    this.songShell.appendChild(this.songNext);

    this.artistHeading = createElement('div', 'song-browser-section-heading song-browser-artist-heading');
    this.artistHeading.appendChild(createElement('h3', '', '作者'));
    this.showAllButton = createElement('button', 'song-browser-show-all', '顯示所有內容');
    this.showAllButton.type = 'button';
    this.showAllButton.addEventListener('click', () => {
      this.activeArtist = '';
      if (this.searchInput) this.searchInput.value = '';
      this.render();
    });
    this.artistHeading.appendChild(this.showAllButton);

    this.artistRail = createElement('div', 'song-browser-artist-rail');
    this.artistRail.setAttribute('aria-label', '歌手篩選');
    this.artistShell = createElement('div', 'song-browser-rail-shell song-browser-artist-shell');
    this.artistShell.appendChild(this.artistRail);
    this.artistNext = createNextButton('向右瀏覽更多作者', this.artistRail);
    this.artistShell.appendChild(this.artistNext);
    this.songShell.after(this.artistHeading, this.artistShell);

    installHorizontalWheel(this.container);
    installHorizontalWheel(this.artistRail);
    this.searchInput?.addEventListener('input', () => this.render());
  }

  setWorks(works = []) {
    this.works = Array.isArray(works) ? works : [];
    this.errorText = '';
    if (this.activeArtist && !collectArtists(this.works).includes(this.activeArtist)) this.activeArtist = '';
    if (this.expandedWorkId && !this.works.some(work => work.workId === this.expandedWorkId)) this.expandedWorkId = null;
    this.render();
  }

  setError(message) {
    this.works = [];
    this.errorText = String(message || '曲譜載入失敗。');
    this.activeArtist = '';
    this.expandedWorkId = null;
    this.render();
  }

  selectedWorks() {
    return filterWorks(this.works, { query: this.searchInput?.value || '', artist: this.activeArtist });
  }

  setCardExpanded(card, expanded) {
    if (!card) return;
    card.classList.toggle('is-expanded', expanded);
    card.setAttribute('aria-expanded', String(expanded));
  }

  toggleWork(workId) {
    const id = String(workId || '');
    const nextExpanded = this.expandedWorkId === id ? null : id;
    if (this.expandedWorkId) {
      this.setCardExpanded(this.container.querySelector(`.work-card[data-work-id="${CSS.escape(this.expandedWorkId)}"]`), false);
    }
    this.expandedWorkId = nextExpanded;
    if (nextExpanded) {
      const card = this.container.querySelector(`.work-card[data-work-id="${CSS.escape(nextExpanded)}"]`);
      this.setCardExpanded(card, true);
      card?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  createArtistAvatar(artist) {
    const avatar = createElement('span', 'artist-filter-avatar');
    const fallback = createElement('span', 'artist-filter-fallback', artistInitial(artist));
    avatar.appendChild(fallback);
    const imageUrl = artistProfileFor(artist)?.image;
    if (imageUrl) {
      const image = document.createElement('img');
      image.className = 'artist-filter-image';
      image.src = imageUrl;
      image.alt = `${artist} 頭像`;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('load', () => avatar.classList.add('has-image'));
      image.addEventListener('error', () => image.remove());
      avatar.appendChild(image);
    }
    return avatar;
  }

  renderArtistRail() {
    this.artistRail.innerHTML = '';
    this.artistHeading.hidden = Boolean(this.errorText);
    this.artistShell.hidden = Boolean(this.errorText);
    if (this.errorText) return;
    const artists = collectArtists(this.works);
    for (const artist of artists) {
      const button = createElement('button', 'artist-filter-button');
      button.type = 'button';
      const active = this.activeArtist === artist;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? `取消 ${artist} 篩選` : `只看 ${artist}`);
      button.append(this.createArtistAvatar(artist), createElement('span', 'artist-filter-label', artist));
      button.addEventListener('click', () => {
        this.activeArtist = this.activeArtist === artist ? '' : artist;
        this.render();
      });
      this.artistRail.appendChild(button);
    }
  }

  createCover(work, extraClass = '') {
    const art = createElement('div', `song-card-art${extraClass ? ` ${extraClass}` : ''}`);
    const fallback = createElement('span', 'song-card-art-fallback', (work.name || 'TAB').trim().slice(0, 2).toUpperCase());
    art.appendChild(fallback);
    if (work.cover) {
      const image = document.createElement('img');
      image.className = 'song-card-art-image';
      image.src = work.cover;
      image.alt = work.album ? `${work.album} 封面` : `${work.name || '曲譜'} 封面`;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('load', () => art.classList.add('has-image'));
      image.addEventListener('error', () => image.remove());
      art.appendChild(image);
    }
    return art;
  }

  createStyleBadges(work) {
    const badges = createElement('div', 'song-card-meta work-card-style-badges');
    const styles = [...new Set((work.arrangements || []).map(item => item.playStyle).filter(value => value === 'fingerstyle' || value === 'chord'))];
    if (!styles.length) styles.push('');
    styles.forEach(style => badges.appendChild(createElement('span', '', playStyleLabel(style))));
    return badges;
  }

  createArrangementRow(work, arrangement) {
    const row = createElement('div', 'work-card-arrangement');
    row.dataset.arrangementId = arrangement.arrangementId || '';
    const info = createElement('div', 'work-card-arrangement-info');
    const title = createElement('strong', 'work-card-arrangement-title', playStyleLabel(arrangement.playStyle));
    const meta = createElement('div', 'work-card-arrangement-meta');
    const values = [difficultyLabel(arrangement.difficulty)];
    if (arrangement.source) values.push(`來源 ${arrangement.source}`);
    values.push(`Capo ${Number(arrangement.capo) || 0}`);
    values.push(`${Number(arrangement.tempo) || 120} BPM`);
    meta.textContent = values.join(' · ');
    info.append(title, meta);
    const actions = createElement('div', 'work-card-arrangement-actions');
    this.renderArrangementActions?.({ work, arrangement, container: actions });
    row.append(info, actions);
    return row;
  }

  createFrontFace(work) {
    const front = createElement('div', 'work-card-face work-card-front');
    const art = this.createCover(work);
    const body = createElement('div', 'song-card-body work-card-copy');
    body.append(
      createElement('h3', '', work.name || '未命名曲譜'),
      createElement('p', 'song-card-artist', work.artist || '未知歌手'),
      this.createStyleBadges(work),
      createElement('p', 'work-card-flip-hint', `${work.arrangements?.length || 0} 個版本 · 點擊展開`)
    );
    front.append(art, body);
    return front;
  }

  createBackFace(work) {
    const back = createElement('div', 'work-card-face work-card-back');
    const summary = createElement('div', 'work-card-back-summary');
    const art = this.createCover(work, 'work-card-back-art');
    const copy = createElement('div', 'work-card-back-copy');
    copy.append(
      createElement('h3', '', work.name || '未命名曲譜'),
      createElement('p', 'song-card-artist', work.artist || '未知歌手'),
      this.createStyleBadges(work)
    );
    const collapse = createElement('button', 'work-card-toggle', '收合');
    collapse.type = 'button';
    collapse.addEventListener('click', event => {
      event.stopPropagation();
      this.toggleWork(work.workId);
    });
    copy.appendChild(collapse);
    summary.append(art, copy);

    const list = createElement('div', 'work-card-arrangements');
    (work.arrangements || []).forEach(arrangement => list.appendChild(this.createArrangementRow(work, arrangement)));
    back.append(summary, list);
    return back;
  }

  createWorkCard(work) {
    const expanded = this.expandedWorkId === work.workId;
    const card = createElement('article', 'song-card work-card');
    card.dataset.workId = work.workId || '';
    card.classList.toggle('is-expanded', expanded);
    card.setAttribute('aria-expanded', String(expanded));
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    const inner = createElement('div', 'work-card-inner');
    inner.append(this.createFrontFace(work), this.createBackFace(work));
    card.appendChild(inner);
    card.addEventListener('click', event => {
      if (event.target.closest('button,a,input,select,textarea')) return;
      this.toggleWork(work.workId);
    });
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button,a,input,select,textarea')) return;
      event.preventDefault();
      this.toggleWork(work.workId);
    });
    return card;
  }

  syncRailControls() {
    requestAnimationFrame(() => {
      this.songNext.hidden = this.container.scrollWidth <= this.container.clientWidth + 2;
      this.artistNext.hidden = this.artistRail.scrollWidth <= this.artistRail.clientWidth + 2;
    });
  }

  render() {
    this.renderArtistRail();
    this.container.innerHTML = '';
    this.songHeading.hidden = false;
    this.songShell.hidden = false;
    if (this.errorText) {
      this.container.appendChild(createElement('p', 'empty-state song-browser-error', this.errorText));
      if (this.countElement) this.countElement.textContent = '';
      this.syncRailControls();
      return;
    }
    const works = this.selectedWorks();
    works.forEach(work => this.container.appendChild(this.createWorkCard(work)));
    if (!works.length) this.container.appendChild(createElement('p', 'empty-state', this.emptyText));
    if (this.countElement) this.countElement.textContent = `${works.length} 首`;
    this.syncRailControls();
  }
}
