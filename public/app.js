const state = {
  catalog: null,
  selected: null,
  remoteResults: [],
  remoteSearchTimer: null,
  lastRemoteQuery: ''
};

const elements = {
  stats: document.querySelector('#stats'),
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
await loadStats();

async function loadStats() {
  try {
    const stats = await api('/providers/vidapi/stats');
    elements.stats.innerHTML = `
      <strong>VidAPI Library</strong><br />
      Movies: ${formatNumber(stats.content_library?.movies)}<br />
      TV Shows: ${formatNumber(stats.content_library?.tv_shows)}<br />
      Episodes: ${formatNumber(stats.content_library?.episodes)}
    `;
  } catch (error) {
    elements.stats.innerHTML = `
      <strong>Catalog Status</strong><br />
      VidAPI connected<br />
      Provider stats unavailable<br />
      Local items: ${formatNumber(state.catalog?.titles?.length ?? 0)}
    `;
  }
}

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

  elements.count.textContent = `No local results. Searching IMDb/TMDB for "${query}"...`;

  try {
    const result = await api(`/providers/search?q=${encodeURIComponent(query)}`);
    state.remoteResults = result.items ?? [];
    renderRemoteResults(query);
  } catch (error) {
    elements.count.textContent = `Search failed: ${error.message}`;
  }
}

function renderRemoteResults(query) {
  const localResults = getFilteredLocalTitles();
  const remoteCards = state.remoteResults
    .map((title, index) => {
      const poster = title.posterUrl;
      return `
        <article class="item" data-remote-index="${index}">
          ${poster ? `<img class="item-poster" src="${escapeAttribute(proxyImageUrl(poster))}" alt="" loading="lazy" />` : '<div class="item-poster placeholder"></div>'}
          <div>
            <strong>${escapeHtml(title.title)}</strong>
            <span class="meta">${escapeHtml(title.type)} | IMDb: ${escapeHtml(title.imdbId || '-')} | ${escapeHtml(title.year ?? '')}</span>
            <span class="meta">${escapeHtml(title.description || 'Remote IMDb result')}</span>
          </div>
        </article>
      `;
    })
    .join('');
  const localCards = renderLocalCards(localResults);
  const total = localResults.length + state.remoteResults.length;

  elements.count.textContent = `${total} matches for "${query}"`;
  elements.items.innerHTML = `${localCards}${remoteCards}`;

  elements.items.querySelectorAll('[data-remote-index]').forEach((item) => {
    item.addEventListener('click', () => {
      const remote = state.remoteResults[Number(item.dataset.remoteIndex)];
      state.selected = normalizeRemoteSelection(remote);
      renderRemoteResults(elements.search.value.trim());
      renderDetail();
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

  if (filtered.length === 0 && query.length >= 3) {
    elements.items.innerHTML = '<div class="empty">Searching IMDb/TMDB...</div>';
  }
}

function getFilteredLocalTitles() {
  const query = elements.search.value.trim().toLowerCase();
  const type = elements.typeFilter.value;
  const titles = state.catalog?.titles ?? [];

  return titles.filter((title) => {
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

function bindLocalCardEvents() {
  elements.items.querySelectorAll('.item').forEach((item) => {
    if (!item.dataset.key) return;
    item.addEventListener('click', () => {
      state.selected = (state.catalog?.titles ?? []).find((title) => title.catalogKey === item.dataset.key);
      renderCatalog();
      renderDetail();
    });
  });
}

function renderDetail() {
  const title = state.selected;
  if (!title) {
    elements.detail.innerHTML = '<div class="empty">Import or select a title to preview the embed.</div>';
    return;
  }

  const providerPage = title.externalPages?.find((page) => page.label === 'vidapi');
  const baseEmbed = providerPage?.url ?? buildFallbackEmbed(title);
  const poster = title.metadata?.posterUrl || title.posterUrl;
  const proxiedPoster = poster ? proxyImageUrl(poster) : '';
  const categories = (title.categories ?? []).join(' / ') || 'Uncategorized';
  const rating = title.metadata?.rating ? `${title.metadata.rating} rating` : '';
  const description = title.metadata?.airDate
    ? `Air date: ${title.metadata.airDate}`
    : title.description || 'Search result loaded on demand. Nothing is saved unless catalog tools are used.';

  elements.detail.innerHTML = `
    <div class="detail-inner">
      <section class="title-hero" style="${proxiedPoster ? `--poster: url('${escapeAttribute(proxiedPoster)}')` : ''}">
        <div class="title-copy">
          <span class="pill">${escapeHtml(title.type)}</span>
          <h2>${escapeHtml(displayTitle(title))}</h2>
          <p class="title-meta">${escapeHtml([title.year, rating, categories].filter(Boolean).join('  |  '))}</p>
          <p class="title-description">${escapeHtml(description)}</p>
          <div class="id-row">
            <span>IMDb: ${escapeHtml(title.imdbId || '-')}</span>
            <span>TMDB: ${escapeHtml(title.tmdbId || '-')}</span>
          </div>
          <div class="actions hero-actions">
            <button id="loadPlayer">Play</button>
            <button class="secondary" id="checkEmbed">Check Not 404</button>
          </div>
        </div>
      </div>

      <div class="player player-standby" id="playerBox">
        <div>
          <strong>Ready to play</strong>
          <p>Review the title information first. Press Play to load the VidAPI iframe.</p>
        </div>
      </div>

      <div class="form-grid">
        <label class="wide">
          Subtitle URL (.srt/.vtt)
          <input id="subUrl" placeholder="https://example.com/subtitles/movie.srt" />
        </label>
        <label>
          Label
          <input id="subLabel" placeholder="Spanish" />
        </label>
        <label>
          Language
          <input id="subLang" placeholder="es" />
        </label>
        <label>
          Subtitle language
          <select id="dsLang">
            <option value="">Auto</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="ja">Japanese</option>
            <option value="pt">Portuguese</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="it">Italian</option>
          </select>
        </label>
        <label>
          Resume at seconds
          <input id="resumeAt" type="number" min="0" placeholder="300" />
        </label>
        <label class="wide">
          Poster override
          <input id="posterUrl" value="${escapeAttribute(poster ?? '')}" />
        </label>
      </div>

      <div class="actions">
        <button id="applyParams">Apply Player Params</button>
      </div>

      <div class="notice">
        Current embed:<br />
        <code id="embedUrl">${escapeHtml(baseEmbed)}</code>
        <div id="checkResult"></div>
      </div>
    </div>
  `;

  document.querySelector('#applyParams').addEventListener('click', () => applyPlayerParams(baseEmbed));
  document.querySelector('#checkEmbed').addEventListener('click', () => checkEmbed());
  document.querySelector('#loadPlayer').addEventListener('click', () => loadPlayer(baseEmbed));
}

function loadPlayer(baseEmbed) {
  document.querySelector('#playerBox').classList.remove('player-standby');
  document.querySelector('#playerBox').innerHTML = `
    <iframe
      id="player"
      src="${escapeAttribute(baseEmbed)}"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
    ></iframe>
  `;
}

function applyPlayerParams(baseEmbed) {
  const url = new URL(baseEmbed);
  const params = {
    sub_url: document.querySelector('#subUrl').value,
    sub_label: document.querySelector('#subLabel').value,
    sub_lang: document.querySelector('#subLang').value,
    ds_lang: document.querySelector('#dsLang').value,
    resumeAt: document.querySelector('#resumeAt').value,
    poster: document.querySelector('#posterUrl').value
  };

  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  if (!document.querySelector('#player')) {
    loadPlayer(url.toString());
  } else {
    document.querySelector('#player').src = url.toString();
  }
  document.querySelector('#embedUrl').textContent = url.toString();
}

async function checkEmbed() {
  const title = state.selected;
  const url = document.querySelector('#embedUrl').textContent;
  const payload = {
    imdbId: title.imdbId,
    tmdbId: title.tmdbId,
    url
  };

  const result = await api('/catalog/external-page-checks', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  document.querySelector('#checkResult').innerHTML = result.failedBecause404
    ? '<p class="error">Embed returned 404.</p>'
    : `<p>HTTP ${result.statusCode}. Not 404: ${result.ok ? 'yes' : 'check manually'}.</p>`;
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
  if (title.type === 'episode') {
    return `https://vaplayer.ru/embed/tv/${encodeURIComponent(id)}/${title.season}/${title.episode}`;
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
