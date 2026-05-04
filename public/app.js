const state = {
  catalog: null,
  selected: null,
  remoteResults: []
};

const elements = {
  stats: document.querySelector('#stats'),
  pages: document.querySelector('#pages'),
  search: document.querySelector('#search'),
  typeFilter: document.querySelector('#typeFilter'),
  remoteSearch: document.querySelector('#remoteSearch'),
  items: document.querySelector('#items'),
  count: document.querySelector('#count'),
  detail: document.querySelector('#detail')
};

document.querySelectorAll('[data-import]').forEach((button) => {
  button.addEventListener('click', () => importCatalog(button.dataset.import));
});

elements.search.addEventListener('input', renderCatalog);
elements.typeFilter.addEventListener('change', renderCatalog);
elements.remoteSearch.addEventListener('click', searchRemoteCatalog);

await loadStats();
await loadCatalog();

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
    elements.stats.textContent = `Stats unavailable: ${error.message}`;
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
    elements.count.textContent = 'Type a search term first';
    return;
  }

  elements.count.textContent = `Searching IMDb/TMDB for "${query}"...`;

  try {
    const result = await api(`/providers/search?q=${encodeURIComponent(query)}`);
    state.remoteResults = result.items ?? [];
    renderRemoteResults(query);
  } catch (error) {
    elements.count.textContent = `Search failed: ${error.message}`;
  }
}

function renderRemoteResults(query) {
  elements.count.textContent = `${state.remoteResults.length} remote matches for "${query}"`;
  elements.items.innerHTML = state.remoteResults
    .map((title, index) => `
      <article class="item" data-remote-index="${index}">
        <strong>${escapeHtml(title.title)}</strong>
        <span class="meta">${escapeHtml(title.type)} | IMDb: ${escapeHtml(title.imdbId || '-')} | ${escapeHtml(title.year ?? '')}</span>
        <span class="meta">${escapeHtml(title.description || 'Remote IMDb result')}</span>
      </article>
    `)
    .join('');

  elements.items.querySelectorAll('[data-remote-index]').forEach((item) => {
    item.addEventListener('click', async () => {
      const remote = state.remoteResults[Number(item.dataset.remoteIndex)];
      const imported = await api('/catalog/import/search-result', {
        method: 'POST',
        body: JSON.stringify(remote)
      });
      await loadCatalog();
      state.selected = (state.catalog?.titles ?? []).find((title) => title.catalogKey === imported.catalogKey);
      renderCatalog();
      renderDetail();
    });
  });
}

function renderCatalog() {
  const query = elements.search.value.trim().toLowerCase();
  const type = elements.typeFilter.value;
  const titles = state.catalog?.titles ?? [];

  const filtered = titles.filter((title) => {
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

  elements.count.textContent = `${filtered.length} items`;
  elements.items.innerHTML = filtered
    .map((title) => {
      const active = state.selected?.catalogKey === title.catalogKey ? ' active' : '';
      return `
        <article class="item${active}" data-key="${escapeHtml(title.catalogKey)}">
          <strong>${escapeHtml(displayTitle(title))}</strong>
          <span class="meta">${escapeHtml(title.type)} | IMDb: ${escapeHtml(title.imdbId || '-')} | TMDB: ${escapeHtml(title.tmdbId || '-')}</span>
          <span class="meta">${escapeHtml((title.categories ?? []).join(', ') || 'no category')}</span>
        </article>
      `;
    })
    .join('');

  elements.items.querySelectorAll('.item').forEach((item) => {
    item.addEventListener('click', () => {
      state.selected = titles.find((title) => title.catalogKey === item.dataset.key);
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
  const poster = title.metadata?.posterUrl;

  elements.detail.innerHTML = `
    <div class="detail-inner">
      <div>
        <h2>${escapeHtml(displayTitle(title))}</h2>
        <p class="meta">${escapeHtml(title.catalogKey)} | ${escapeHtml(title.year ?? '')}</p>
      </div>

      <div class="player">
        <iframe id="player" src="${escapeAttribute(baseEmbed)}" allowfullscreen></iframe>
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
          Auto subtitle language
          <input id="dsLang" placeholder="es" />
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
        <button class="secondary" id="checkEmbed">Check Not 404</button>
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

  document.querySelector('#player').src = url.toString();
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
