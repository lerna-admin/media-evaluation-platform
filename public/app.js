const state = {
  catalog: null,
  selected: null,
  seriesEpisodes: null,
  seriesEpisodesLoading: false,
  hydratedProgressId: '',
  remoteResults: [],
  remoteSearchTimer: null,
  lastRemoteQuery: '',
  isSearching: false,
  playback: {
    season: 1,
    episode: 1
  }
};

const elements = {
  pages: document.querySelector('#pages'),
  search: document.querySelector('#search'),
  typeFilter: document.querySelector('#typeFilter'),
  tabs: document.querySelectorAll('[data-type-tab]'),
  items: document.querySelector('#items'),
  count: document.querySelector('#count'),
  detail: document.querySelector('#detail')
};

document.querySelectorAll('[data-import]').forEach((button) => {
  button.addEventListener('click', () => importCatalog(button.dataset.import));
});

elements.search.addEventListener('input', () => {
  renderCatalog();
  scheduleRemoteSearchIfNeeded();
});
elements.typeFilter.addEventListener('change', () => {
  syncTabs(elements.typeFilter.value);
  renderCatalog();
  scheduleRemoteSearchIfNeeded();
});
elements.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    elements.typeFilter.value = tab.dataset.typeTab;
    syncTabs(tab.dataset.typeTab);
    renderCatalog();
    scheduleRemoteSearchIfNeeded();
  });
});
await loadCatalog();

async function loadCatalog() {
  state.catalog = await api('/catalog');
  renderCatalog();
}

async function importCatalog(kind) {
  const pages = Number(elements.pages.value || 1);
  const endpoint = `/catalog/import/vidapi/${kind}`;
  elements.count.textContent = `Importing ${kind}...`;
  await api(endpoint, {
    method: 'POST',
    body: JSON.stringify({ pages })
  });
  await loadCatalog();
}

async function searchRemoteCatalog() {
  const query = elements.search.value.trim();
  if (!query) {
    return;
  }

  state.isSearching = true;
  renderCatalog();
  elements.count.textContent = `No local results. Searching IMDb/TMDB for "${query}"...`;

  try {
    const result = await api(`/providers/search?q=${encodeURIComponent(query)}`);
    state.remoteResults = result.items ?? [];
    renderRemoteResults(query);
    cacheSearchResults(state.remoteResults);
  } catch (error) {
    elements.count.textContent = `Search failed: ${error.message}`;
  } finally {
    state.isSearching = false;
  }
}

function renderRemoteResults(query) {
  const localResults = getFilteredLocalTitles();
  const merged = mergeAndRankResults(localResults, state.remoteResults, query);
  const cards = merged
    .map((entry, index) => {
      const title = entry.title;
      const poster = title.posterUrl || title.metadata?.posterUrl || '';
      const description = title.description || title.metadata?.description || title.metadata?.cast || '';
      return `
        <article class="item" ${entry.source === 'remote' ? `data-remote-index="${index}"` : `data-key="${escapeHtml(title.catalogKey)}"`}>
          ${poster ? `<img class="item-poster" src="${escapeAttribute(proxyImageUrl(poster))}" alt="" loading="lazy" />` : '<div class="item-poster placeholder"></div>'}
          <div>
            <strong>${escapeHtml(title.title)}</strong>
            <span class="meta">${escapeHtml(title.type)} | IMDb: ${escapeHtml(title.imdbId || '-')} | ${escapeHtml(title.year ?? '')}</span>
            <span class="meta">${escapeHtml(description || 'IMDb result')}</span>
          </div>
        </article>
      `;
    })
    .join('');
  const total = merged.length;

  elements.count.textContent = `${total} matches for "${query}"`;
  elements.items.innerHTML = cards;

  elements.items.querySelectorAll('[data-remote-index]').forEach((item) => {
    item.addEventListener('click', async () => {
      const entry = merged[Number(item.dataset.remoteIndex)];
      const remote = entry?.title;
      if (!remote) return;
      state.selected = normalizeRemoteSelection(remote);
      state.seriesEpisodes = null;
      state.seriesEpisodesLoading = isSeriesLike(state.selected);
      state.hydratedProgressId = '';
      renderRemoteResults(elements.search.value.trim());
      await renderDetail();
      if (isSeriesLike(state.selected)) {
        loadSeriesEpisodes().then(() => renderDetail());
      }
    });
  });
  bindLocalCardEvents();
}

function scheduleRemoteSearchIfNeeded() {
  clearTimeout(state.remoteSearchTimer);

  const query = elements.search.value.trim();
  if (query.length < 3) return;

  state.remoteSearchTimer = setTimeout(() => {
    if (state.lastRemoteQuery === query.toLowerCase()) return;
    state.lastRemoteQuery = query.toLowerCase();
    searchRemoteCatalog();
  }, 450);
}

function renderCatalog() {
  const query = elements.search.value.trim().toLowerCase();
  const filtered = getFilteredLocalTitles();

  state.localResultCount = filtered.length;
  elements.count.textContent = `${filtered.length} items`;
  elements.items.innerHTML = renderLocalCards(filtered);
  bindLocalCardEvents();

  if (filtered.length === 0 && query.length >= 3 && state.isSearching) {
    elements.items.innerHTML = `
      <div class="loader-card">
        <span class="spinner"></span>
        <strong>Searching IMDb/TMDB</strong>
        <p>Looking for playable titles...</p>
      </div>
    `;
  }
}

function getFilteredLocalTitles() {
  const query = elements.search.value.trim().toLowerCase();
  const type = elements.typeFilter.value;
  const titles = state.catalog?.titles ?? [];

  return titles.filter((title) => {
    if (title.type === 'episode') return false;
    const haystack = [
      title.title,
      title.showTitle,
      title.imdbId,
      title.tmdbId,
      title.catalogKey,
      title.categories?.join(' ')
    ].join(' ').toLowerCase();

    return (type === 'all' || title.type === type) && (!query || haystack.includes(query));
  });
}

async function cacheSearchResults(results) {
  const toPersist = results.slice(0, 24);
  if (toPersist.length === 0) return;

  await Promise.allSettled(
    toPersist.map((title) => api('/catalog/import/search-result', {
      method: 'POST',
      body: JSON.stringify({
        type: title.type,
        imdbId: title.imdbId,
        tmdbId: title.tmdbId,
        title: title.title,
        year: title.year,
        categories: [],
        posterUrl: title.posterUrl
      })
    }))
  );

  try {
    state.catalog = await api('/catalog');
    if (!state.selected) {
      renderCatalog();
    }
  } catch {
    // Ignore background refresh failures.
  }
}

function renderLocalCards(titles) {
  return titles
    .map((title) => {
      const active = state.selected?.catalogKey === title.catalogKey ? ' active' : '';
      const poster = title.metadata?.posterUrl;
      return `
        <article class="item${active}" data-key="${escapeHtml(title.catalogKey)}">
          ${poster ? `<img class="item-poster" src="${escapeAttribute(proxyImageUrl(poster))}" alt="" loading="lazy" />` : '<div class="item-poster placeholder"></div>'}
          <div>
            <strong>${escapeHtml(displayTitle(title))}</strong>
            <span class="meta">${escapeHtml(title.type)} | ${escapeHtml(title.year ?? '')}</span>
            <span class="meta">${escapeHtml((title.categories ?? []).slice(0, 2).join(', ') || title.imdbId || title.tmdbId || 'no id')}</span>
          </div>
        </article>
      `;
    })
    .join('');
}

function mergeAndRankResults(localResults, remoteResults, query) {
  const normalizedQuery = String(query ?? '').trim().toLowerCase();
  const all = [
    ...localResults.map((title) => ({ source: 'local', title })),
    ...remoteResults.map((title) => ({ source: 'remote', title }))
  ];
  const seen = new Set();
  const deduped = [];

  for (const entry of all) {
    const title = entry.title;
    const key = [
      title.imdbId || '',
      title.tmdbId || '',
      String(title.title || '').toLowerCase(),
      String(title.year || '')
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  deduped.sort((a, b) => scoreResult(b.title, normalizedQuery) - scoreResult(a.title, normalizedQuery));
  return deduped;
}

function scoreResult(title, query) {
  const name = String(title.title || '').toLowerCase();
  let score = 0;
  if (name === query) score += 100;
  if (name.startsWith(query)) score += 40;
  if (name.includes(query)) score += 20;
  if (title.type === 'series') score += 10;
  if (title.imdbId) score += 2;
  return score;
}

function bindLocalCardEvents() {
  elements.items.querySelectorAll('.item').forEach((item) => {
    if (!item.dataset.key) return;
    item.addEventListener('click', async () => {
      state.selected = (state.catalog?.titles ?? []).find((title) => title.catalogKey === item.dataset.key);
      state.seriesEpisodes = null;
      state.seriesEpisodesLoading = isSeriesLike(state.selected);
      state.hydratedProgressId = '';
      renderCatalog();
      await renderDetail();
      if (isSeriesLike(state.selected)) {
        loadSeriesEpisodes().then(() => renderDetail());
      }
    });
  });
}

async function renderDetail() {
  const title = state.selected;
  if (!title) {
    elements.detail.innerHTML = '';
    return;
  }

  const providerPage = title.externalPages?.find((page) => page.label === 'vidapi');
  const baseEmbed = providerPage?.url ?? buildFallbackEmbed(title);
  state.playback.season = title.season || state.playback.season || 1;
  state.playback.episode = title.episode || state.playback.episode || 1;
  applySavedWatchState(title);
  const poster = title.metadata?.posterUrl || title.posterUrl;
  const proxiedPoster = poster ? proxyImageUrl(poster) : '';
  const categories = (title.categories ?? []).join(' / ');
  const rating = title.metadata?.rating ? `${title.metadata.rating} rating` : '';
  const description = title.description || title.metadata?.description || title.metadata?.cast || 'Información de la serie no disponible.';
  const progress = getSeriesProgress(title);
  const hasEpisodes = isSeriesLike(title) && (state.seriesEpisodes?.seasons?.length ?? 0) > 0;
  const hasWatchHistory = Boolean(Object.keys(progress?.watched ?? {}).length);
  const resumeTarget = hasEpisodes ? getNextEpisodeTarget(progress, state.seriesEpisodes) : null;
  const resumeLabel = resumeTarget ? `Reanudar T${resumeTarget.season}E${resumeTarget.episode}` : 'Reanudar';
  if (hasEpisodes && !getEpisodesForSeason(state.playback.season).length) {
    state.playback.season = state.seriesEpisodes.seasons[0].seasonNumber;
  }
  const seasonsTabs = hasEpisodes
    ? state.seriesEpisodes.seasons.map((entry) => `
      <button class="season-tab${entry.seasonNumber === state.playback.season ? ' active' : ''}" data-season="${entry.seasonNumber}">
        T${entry.seasonNumber}
      </button>
    `).join('')
    : '';
  const episodeCards = hasEpisodes
    ? getEpisodesForSeason(state.playback.season).map((entry) => {
      const watched = isEpisodeWatched(progress, state.playback.season, entry.episode);
      const current = state.playback.episode === entry.episode;
      return `
        <button class="episode-card${watched ? ' watched' : ''}${current ? ' current' : ''}" data-episode="${entry.episode}">
          <span class="episode-code">E${entry.episode}</span>
          <span class="episode-title">${escapeHtml(entry.title || `Episode ${entry.episode}`)}</span>
          ${watched ? '<span class="episode-status">Visto</span>' : ''}
        </button>
      `;
    }).join('')
    : '';

  elements.detail.innerHTML = `
    <div class="detail-inner overlay-open">
      <button class="overlay-close" id="closeDetail">Back to results</button>
      <section class="title-hero" style="${proxiedPoster ? `--poster: url('${escapeAttribute(proxiedPoster)}')` : ''}">
        <div class="title-copy">
          <span class="pill">${escapeHtml(title.type)}</span>
          <h2>${escapeHtml(displayTitle(title))}</h2>
          <p class="title-meta">${escapeHtml([title.year, rating, categories].filter(Boolean).join('  |  '))}</p>
          <p class="title-description">${escapeHtml(description)}</p>
          <div class="actions hero-actions">
            ${!isSeriesLike(title) ? '<button id="loadPlayer">Play</button>' : ''}
            ${isSeriesLike(title) && hasWatchHistory && resumeTarget ? `<button id="resumeSeries">${escapeHtml(resumeLabel)}</button>` : ''}
          </div>
        </div>
      </section>

      ${isSeriesLike(title) ? `
      <section class="seasons-panel">
        <div class="seasons-tabs">${seasonsTabs || `<span class="episode-hint">${state.seriesEpisodesLoading ? 'Cargando temporadas...' : 'No se encontraron temporadas.'}</span>`}</div>
        <div class="episodes-grid">${episodeCards || `<span class="episode-hint">${state.seriesEpisodesLoading ? 'Cargando capítulos...' : 'No se encontraron capítulos.'}</span>`}</div>
      </section>
      ` : ''}

      <div id="playerModal" class="player-modal" hidden>
        <div class="player-modal-backdrop" data-close-player></div>
        <div class="player-modal-card">
          <button class="player-close" id="closePlayer">Close</button>
          <iframe
            id="player"
            src="about:blank"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    </div>
  `;

  document.querySelector('#loadPlayer')?.addEventListener('click', () => {
    openPlayerModal(getCurrentEmbedUrl(baseEmbed));
  });
  document.querySelector('#resumeSeries')?.addEventListener('click', () => {
    if (!resumeTarget) return;
    state.playback.season = resumeTarget.season;
    state.playback.episode = resumeTarget.episode;
    openPlayerModal(getCurrentEmbedUrl(baseEmbed));
  });
  document.querySelector('#closeDetail')?.addEventListener('click', () => {
    state.selected = null;
    state.seriesEpisodes = null;
    state.hydratedProgressId = '';
    renderCatalog();
    renderDetail();
  });
  document.querySelector('#closePlayer')?.addEventListener('click', closePlayerModal);
  document.querySelector('[data-close-player]')?.addEventListener('click', closePlayerModal);
  document.querySelectorAll('[data-season]').forEach((button) => {
    button.addEventListener('click', () => {
      state.playback.season = positiveInteger(button.dataset.season, state.playback.season);
      const seasonEpisodes = getEpisodesForSeason(state.playback.season);
      if (!seasonEpisodes.some((entry) => entry.episode === state.playback.episode)) {
        state.playback.episode = seasonEpisodes[0]?.episode ?? 1;
      }
      renderDetail();
    });
  });
  document.querySelectorAll('[data-episode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.playback.episode = positiveInteger(button.dataset.episode, state.playback.episode);
      openPlayerModal(getCurrentEmbedUrl(baseEmbed));
    });
  });

}

function openPlayerModal(embedUrl) {
  persistLastSelection();
  const modal = document.querySelector('#playerModal');
  const card = document.querySelector('.player-modal-card');
  const iframe = document.querySelector('#player');
  if (!modal || !iframe) return;
  iframe.src = embedUrl;
  modal.hidden = false;
  requestNativeFullscreen(card);
}

function closePlayerModal() {
  const modal = document.querySelector('#playerModal');
  const iframe = document.querySelector('#player');
  if (!modal || !iframe) return;
  modal.hidden = true;
  iframe.src = 'about:blank';
  exitNativeFullscreenIfAny();
}

function requestNativeFullscreen(element) {
  if (!element) return;
  const doc = document;
  if (doc.fullscreenElement) return;
  const fn = element.requestFullscreen || element.webkitRequestFullscreen || element.msRequestFullscreen;
  if (typeof fn === 'function') {
    fn.call(element).catch?.(() => {});
  }
}

function exitNativeFullscreenIfAny() {
  const doc = document;
  if (doc.fullscreenElement && doc.exitFullscreen) {
    doc.exitFullscreen().catch?.(() => {});
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

function displayTitle(title) {
  if (title.type === 'episode') {
    return `${title.showTitle || 'Series'} S${title.season}E${title.episode}: ${title.title}`;
  }
  return title.title || title.imdbId || title.tmdbId || 'Untitled';
}

function buildFallbackEmbed(title) {
  const id = title.imdbId || title.tmdbId;
  if (title.type === 'movie') return `https://vaplayer.ru/embed/movie/${encodeURIComponent(id)}`;
  if (title.type === 'episode' || title.type === 'series') {
    const season = title.season || state.playback.season || 1;
    const episode = title.episode || state.playback.episode || 1;
    return `https://vaplayer.ru/embed/tv/${encodeURIComponent(id)}/${season}/${episode}`;
  }
  return `https://vaplayer.ru/embed/tv/${encodeURIComponent(id)}`;
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString('en-US');
}

function proxyImageUrl(url) {
  return `/image-proxy?url=${encodeURIComponent(url)}`;
}

function syncTabs(type) {
  elements.tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.typeTab === type);
  });
}

function normalizeRemoteSelection(remote) {
  const type = remote.type === 'series' ? 'series' : 'movie';
  const id = remote.imdbId || remote.tmdbId;

  return {
    catalogKey: `${type}:${remote.imdbId ? 'imdb' : 'tmdb'}:${id}`,
    type,
    imdbId: remote.imdbId || '',
    tmdbId: remote.tmdbId || '',
    title: remote.title,
    year: remote.year,
    categories: [],
    description: remote.description,
    posterUrl: remote.posterUrl,
    metadata: {
      provider: remote.provider,
      posterUrl: remote.posterUrl
    },
    externalPages: [
      {
        label: 'vidapi',
        url: type === 'movie'
          ? `https://vaplayer.ru/embed/movie/${encodeURIComponent(id)}`
          : `https://vaplayer.ru/embed/tv/${encodeURIComponent(id)}`
      }
    ]
  };
}

function persistLastSelection() {
  if (!state.selected) return;
  try {
    localStorage.setItem('mep_last_selection', JSON.stringify({
      imdbId: state.selected.imdbId || '',
      tmdbId: state.selected.tmdbId || '',
      type: state.selected.type || 'movie',
      season: state.playback.season || 1,
      episode: state.playback.episode || 1,
      title: state.selected.title || '',
      updatedAt: new Date().toISOString()
    }));
  } catch {
    // Ignore local storage errors.
  }
}

function isSeriesLike(title) {
  return title.type === 'series' || title.type === 'episode';
}

function applySavedWatchState(title) {
  try {
    const currentId = title.imdbId || title.tmdbId;
    if (!currentId || state.hydratedProgressId === currentId) return;

    const seriesProgress = getSeriesProgress(title);
    if (isSeriesLike(title)) {
      state.playback.season = positiveInteger(seriesProgress.lastSeason, state.playback.season);
      state.playback.episode = positiveInteger(seriesProgress.lastEpisode, state.playback.episode);
    }

    const raw = localStorage.getItem('mep_last_watch');
    if (!raw) return;
    const saved = JSON.parse(raw);
    const savedId = saved?.imdbId || saved?.tmdbId || saved?.id;
    if (!currentId || currentId !== savedId) return;

    if (isSeriesLike(title)) {
      state.playback.season = positiveInteger(saved.season, state.playback.season);
      state.playback.episode = positiveInteger(saved.episode, state.playback.episode);
    }
    state.hydratedProgressId = currentId;

  } catch {
    // Ignore invalid saved data.
  }
}

function getEpisodesForSeason(seasonNumber) {
  const season = (state.seriesEpisodes?.seasons ?? []).find((entry) => entry.seasonNumber === seasonNumber);
  return season?.episodes ?? [];
}

async function loadSeriesEpisodes() {
  if (!state.selected || !isSeriesLike(state.selected)) return;
  state.seriesEpisodesLoading = true;

  const params = new URLSearchParams();
  if (state.selected.imdbId) params.set('imdbId', state.selected.imdbId);
  if (state.selected.tmdbId) params.set('tmdbId', state.selected.tmdbId);
  params.set('pages', '12');

  try {
    const data = await api(`/providers/vidapi/series-episodes?${params.toString()}`);
    state.seriesEpisodes = data;
    const firstSeason = data.seasons?.[0];
    if (firstSeason) {
      state.playback.season = firstSeason.seasonNumber;
      state.playback.episode = firstSeason.episodes?.[0]?.episode ?? 1;
    }
  } catch {
    state.seriesEpisodes = { seasons: [] };
  } finally {
    state.seriesEpisodesLoading = false;
  }
}

function getCurrentEmbedUrl(baseEmbed) {
  if (!isSeriesLike(state.selected)) return baseEmbed;
  const id = state.selected.imdbId || state.selected.tmdbId;
  const season = positiveInteger(state.playback.season, 1);
  const episode = positiveInteger(state.playback.episode, 1);
  state.playback.season = season;
  state.playback.episode = episode;
  return `https://vaplayer.ru/embed/tv/${encodeURIComponent(id)}/${season}/${episode}`;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'PLAYER_EVENT') return;
  persistProgressFromPlayerEvent(event.data.data);
  if (event.data.data?.player_status !== 'completed') return;
  if (!isSeriesLike(state.selected)) return;

  const episodes = getEpisodesForSeason(state.playback.season);
  const currentIndex = episodes.findIndex((entry) => entry.episode === state.playback.episode);
  const nextEntry = currentIndex >= 0 ? episodes[currentIndex + 1] : null;

  if (nextEntry) {
    state.playback.episode = nextEntry.episode;
  } else {
    state.playback.season += 1;
    const firstOfNextSeason = getEpisodesForSeason(state.playback.season)[0];
    if (!firstOfNextSeason) return;
    state.playback.episode = firstOfNextSeason.episode;
  }

  const nextUrl = getCurrentEmbedUrl(buildFallbackEmbed(state.selected));
  const modal = document.querySelector('#playerModal');
  const iframe = document.querySelector('#player');
  if (modal && iframe && !modal.hidden) {
    iframe.src = nextUrl;
  } else {
    openPlayerModal(nextUrl);
  }
});

function persistProgressFromPlayerEvent(data) {
  if (!data || !['playing', 'paused', 'seeked', 'completed'].includes(data.player_status)) return;
  const info = data.player_info ?? {};
  const id = info.imdb || info.tmdb || state.selected?.imdbId || state.selected?.tmdbId;
  if (!id) return;
  const snapshot = {
    id,
    imdbId: info.imdb || state.selected?.imdbId || '',
    tmdbId: info.tmdb || state.selected?.tmdbId || '',
    mediaType: info.mediaType || state.selected?.type || 'movie',
    season: Number(info.season || state.playback.season || 1),
    episode: Number(info.episode || state.playback.episode || 1),
    progress: Number(data.player_progress || 0),
    updatedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem('mep_last_watch', JSON.stringify(snapshot));
    if (snapshot.imdbId || snapshot.tmdbId) {
      const key = `mep_series_progress_${snapshot.imdbId || snapshot.tmdbId}`;
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      const watched = existing.watched || {};
      const mapKey = `s${snapshot.season}e${snapshot.episode}`;
      if (snapshot.progress > 60 || data.player_status === 'completed') watched[mapKey] = true;
      const merged = {
        ...existing,
        id: snapshot.imdbId || snapshot.tmdbId,
        lastSeason: snapshot.season,
        lastEpisode: snapshot.episode,
        watched
      };
      localStorage.setItem(key, JSON.stringify(merged));
    }
  } catch {
    // Ignore local storage errors.
  }
}

function getSeriesProgress(title) {
  const id = title.imdbId || title.tmdbId;
  if (!id) return { watched: {} };
  try {
    return JSON.parse(localStorage.getItem(`mep_series_progress_${id}`) || '{"watched":{}}');
  } catch {
    return { watched: {} };
  }
}

function isEpisodeWatched(progress, season, episode) {
  return Boolean(progress?.watched?.[`s${season}e${episode}`]);
}

function getNextEpisodeTarget(progress, seriesEpisodes) {
  const seasons = seriesEpisodes?.seasons ?? [];
  if (seasons.length === 0) return null;

  const lastSeason = positiveInteger(progress?.lastSeason, seasons[0].seasonNumber);
  const lastEpisode = positiveInteger(progress?.lastEpisode, 0);
  const currentSeasonEpisodes = seasons.find((s) => s.seasonNumber === lastSeason)?.episodes ?? [];
  const nextInSeason = currentSeasonEpisodes.find((ep) => ep.episode > lastEpisode);
  if (nextInSeason) {
    return { season: lastSeason, episode: nextInSeason.episode };
  }

  const nextSeason = seasons.find((s) => s.seasonNumber > lastSeason && s.episodes.length > 0);
  if (nextSeason) {
    return { season: nextSeason.seasonNumber, episode: nextSeason.episodes[0].episode };
  }

  return { season: seasons[0].seasonNumber, episode: seasons[0].episodes[0]?.episode ?? 1 };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
