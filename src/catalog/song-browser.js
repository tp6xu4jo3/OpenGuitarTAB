import { aggregateCatalogWorks } from './work-model.js';

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
    this.artistRail = createElement('div', 'song-browser-artist-rail');
    this.artistRail.setAttribute('aria-label', '歌手篩選');
    this.container.before(this.artistRail);
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

  toggleWork(workId) {
    this.expandedWorkId = this.expandedWorkId === workId ? null : workId;
    this.render();
  }

  renderArtistRail() {
    this.artistRail.innerHTML = '';
    this.artistRail.hidden = Boolean(this.errorText);
    if (this.errorText) return;
    const artists = collectArtists(this.works);
    const options = [{ value: '', label: '全部', initial: '全' }, ...artists.map(artist => ({ value: artist, label: artist, initial: artistInitial(artist) }))];
    for (const option of options) {
      const button = createElement('button', 'artist-filter-button');
      button.type = 'button';
      button.classList.toggle('active', this.activeArtist === option.value);
      button.setAttribute('aria-pressed', String(this.activeArtist === option.value));
      button.setAttribute('aria-label', option.value ? `只看 ${option.label}` : '顯示全部歌手');
      const avatar = createElement('span', 'artist-filter-avatar', option.initial);
      const label = createElement('span', 'artist-filter-label', option.label);
      button.append(avatar, label);
      button.addEventListener('click', () => { this.activeArtist = option.value; this.render(); });
      this.artistRail.appendChild(button);
    }
  }

  createCover(work) {
    const art = createElement('div', 'song-card-art');
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

  createWorkCard(work) {
    const expanded = this.expandedWorkId === work.workId;
    const card = createElement('article', 'song-card work-card');
    card.dataset.workId = work.workId || '';
    card.classList.toggle('is-expanded', expanded);
    card.setAttribute('aria-expanded', String(expanded));
    const art = this.createCover(work);
    const body = createElement('div', 'song-card-body work-card-copy');
    const title = createElement('h3', '', work.name || '未命名曲譜');
    const artist = createElement('p', 'song-card-artist', work.artist || '未知歌手');
    if (work.album) artist.title = work.album;
    const badges = createElement('div', 'song-card-meta work-card-style-badges');
    const styles = [...new Set((work.arrangements || []).map(item => item.playStyle).filter(value => value === 'fingerstyle' || value === 'chord'))];
    if (!styles.length) styles.push('');
    styles.forEach(style => badges.appendChild(createElement('span', '', playStyleLabel(style))));
    const hint = createElement('button', 'work-card-toggle', expanded ? '收合版本' : `${work.arrangements?.length || 0} 個版本`);
    hint.type = 'button';
    hint.addEventListener('click', event => { event.stopPropagation(); this.toggleWork(work.workId); });
    body.append(title, artist, badges, hint);
    card.append(art, body);
    if (expanded) {
      const list = createElement('div', 'work-card-arrangements');
      (work.arrangements || []).forEach(arrangement => list.appendChild(this.createArrangementRow(work, arrangement)));
      card.appendChild(list);
    }
    card.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      this.toggleWork(work.workId);
    });
    return card;
  }

  render() {
    this.renderArtistRail();
    this.container.innerHTML = '';
    if (this.errorText) {
      this.container.appendChild(createElement('p', 'empty-state song-browser-error', this.errorText));
      if (this.countElement) this.countElement.textContent = '';
      return;
    }
    const works = this.selectedWorks();
    works.forEach(work => this.container.appendChild(this.createWorkCard(work)));
    if (!works.length) this.container.appendChild(createElement('p', 'empty-state', this.emptyText));
    if (this.countElement) this.countElement.textContent = `${works.length} 首`;
  }
}
