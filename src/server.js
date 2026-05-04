import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExternalPage, createCategory, createTitle, notFound, upsertProviderTitle } from './catalog.js';
import { readStore, writeStore } from './storage.js';
import {
  buildMovieEmbedUrl,
  buildTvEmbedUrl,
  fetchLatestEpisodes,
  fetchLatestMovies,
  fetchLatestTvShows,
  fetchStats,
  isPlayableEmbed,
  normalizeEpisodeItem,
  normalizeMovieItem,
  normalizeTvShowItem
} from './vidapi.js';
import { searchImdbSuggestions } from './search-providers.js';

const port = Number(process.env.PORT ?? 4000);
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '../public');
const episodeListCacheByImdb = new Map();
let epsImdbRawCache = {
  loadedAt: 0,
  text: ''
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const route = `${request.method} ${url.pathname}`;

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/public/'))) {
      return servePublic(response, url.pathname === '/' ? '/index.html' : url.pathname.replace('/public', ''));
    }

    if (request.method === 'GET' && url.pathname === '/image-proxy') {
      return proxyImage(response, requiredParam(url, 'url'));
    }

    if (route === 'GET /health') {
      return json(response, 200, { status: 'ok' });
    }

    if (route === 'GET /catalog') {
      return json(response, 200, filterStoreForListing(await readStore()));
    }

    if (route === 'POST /catalog/categories') {
      const store = await readStore();
      const category = createCategory(store, await readJson(request));
      await writeStore(store);
      return json(response, 201, category);
    }

    if (route === 'POST /catalog/movies') {
      const store = await readStore();
      const title = createTitle(store, await readJson(request), 'movie');
      await writeStore(store);
      return json(response, 201, title);
    }

    if (route === 'POST /catalog/series') {
      const store = await readStore();
      const title = createTitle(store, await readJson(request), 'series');
      await writeStore(store);
      return json(response, 201, title);
    }

    if (route === 'POST /catalog/episodes') {
      const store = await readStore();
      const title = createTitle(store, await readJson(request), 'episode');
      await writeStore(store);
      return json(response, 201, title);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/catalog/titles/')) {
      const id = url.pathname.split('/').at(-1);
      const store = await readStore();
      const title = store.titles.find((entry) => entry.imdbId === id || entry.tmdbId === id);
      if (!title) throw notFound(`Title ${id} is not in catalog.`);
      return json(response, 200, title);
    }

    if (route === 'POST /catalog/external-page-checks') {
      const store = await readStore();
      const asset = await checkExternalPage(store, await readJson(request));
      await writeStore(store);
      return json(response, 201, asset);
    }

    if (route === 'GET /providers/vidapi/stats') {
      return json(response, 200, await fetchStats());
    }

    if (route === 'GET /providers/vidapi/movies/latest') {
      const page = positivePage(url.searchParams.get('page'));
      return json(response, 200, await fetchLatestMovies(page));
    }

    if (route === 'GET /providers/vidapi/tvshows/latest') {
      const page = positivePage(url.searchParams.get('page'));
      return json(response, 200, await fetchLatestTvShows(page));
    }

    if (route === 'GET /providers/vidapi/episodes/latest') {
      const page = positivePage(url.searchParams.get('page'));
      return json(response, 200, await fetchLatestEpisodes(page));
    }

    if (route === 'GET /providers/vidapi/search') {
      const query = requiredParam(url, 'q').toLowerCase();
      const type = url.searchParams.get('type') ?? 'movie';
      const maxPages = Math.min(positivePage(url.searchParams.get('pages')), 100);
      return json(response, 200, await searchVidapi(type, query, maxPages));
    }

    if (route === 'GET /providers/search') {
      const query = requiredParam(url, 'q');
      const results = await searchImdbSuggestions(query);
      return json(response, 200, {
        query,
        items: await filterPlayableResults(results)
      });
    }

    if (route === 'GET /providers/vidapi/series-episodes') {
      const imdbId = String(url.searchParams.get('imdbId') ?? '').trim();
      const tmdbId = String(url.searchParams.get('tmdbId') ?? '').trim();
      const pages = Math.min(positivePage(url.searchParams.get('pages')), 120);

      if (!imdbId && !tmdbId) {
        const error = new Error('imdbId or tmdbId is required.');
        error.status = 400;
        throw error;
      }

      return json(response, 200, await getSeriesEpisodes({ imdbId, tmdbId, pages }));
    }

    if (route === 'GET /providers/vidapi/embed/movie') {
      const id = requiredParam(url, 'id');
      return json(response, 200, {
        id,
        embedUrl: buildMovieEmbedUrl(id, queryParamsWithout(url, ['id']))
      });
    }

    if (route === 'GET /providers/vidapi/embed/tv') {
      const id = requiredParam(url, 'id');
      const season = url.searchParams.get('season');
      const episode = url.searchParams.get('episode');
      return json(response, 200, {
        id,
        season,
        episode,
        embedUrl: buildTvEmbedUrl(id, season, episode, queryParamsWithout(url, ['id', 'season', 'episode']))
      });
    }

    if (route === 'POST /catalog/import/vidapi/latest-movies') {
      const body = await readJson(request);
      const result = await importVidapiPages('movie', positivePage(body.pages ?? 1));
      return json(response, 201, result);
    }

    if (route === 'POST /catalog/import/vidapi/latest-tvshows') {
      const body = await readJson(request);
      const result = await importVidapiPages('series', positivePage(body.pages ?? 1));
      return json(response, 201, result);
    }

    if (route === 'POST /catalog/import/vidapi/latest-episodes') {
      const body = await readJson(request);
      const result = await importVidapiPages('episode', positivePage(body.pages ?? 1));
      return json(response, 201, result);
    }

    if (route === 'POST /catalog/import/vidapi/search') {
      const body = await readJson(request);
      const result = await importVidapiSearch(
        body.type ?? 'movie',
        String(body.query ?? '').toLowerCase(),
        Math.min(positivePage(body.pages ?? 25), 100)
      );
      return json(response, 201, result);
    }

    if (route === 'POST /catalog/import/manual') {
      const body = await readJson(request);
      const store = await readStore();
      const id = String(body.imdbId || body.tmdbId || '').trim();
      const type = body.type === 'series' ? 'series' : 'movie';
      const embedUrl = type === 'movie' ? buildMovieEmbedUrl(id) : buildTvEmbedUrl(id);
      await assertPlayable(embedUrl);
      const result = upsertProviderTitle(store, {
        type,
        imdbId: body.imdbId,
        tmdbId: body.tmdbId,
        title: body.title,
        year: body.year,
        categories: body.categories ?? [],
        posterUrl: body.posterUrl,
        embedUrl
      });
      await writeStore(store);
      return json(response, 201, result.title);
    }

    if (route === 'POST /catalog/import/search-result') {
      const body = await readJson(request);
      const store = await readStore();
      const id = String(body.imdbId || body.tmdbId || '').trim();
      const type = body.type === 'series' ? 'series' : 'movie';
      const embedUrl = type === 'movie' ? buildMovieEmbedUrl(id) : buildTvEmbedUrl(id);
      await assertPlayable(embedUrl);
      const result = upsertProviderTitle(store, {
        type,
        imdbId: body.imdbId,
        tmdbId: body.tmdbId,
        title: body.title,
        year: body.year,
        categories: body.categories ?? [],
        posterUrl: body.posterUrl,
        embedUrl
      });
      await writeStore(store);
      return json(response, 201, result.title);
    }

    throw notFound('Route not found.');
  } catch (error) {
    return json(response, error.status ?? 500, {
      error: error.message ?? 'Internal server error'
    });
  }
});

server.listen(port, () => {
  console.log(`Media Evaluation Platform API listening on http://localhost:${port}`);
});

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(response, status, payload) {
  response.writeHead(status, {
    ...securityHeaders(),
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function servePublic(response, pathname) {
  const safePath = pathname.replace(/^\/+/, '');
  const filePath = resolve(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) throw notFound('Static file not found.');

  const content = await readFile(filePath);
  response.writeHead(200, {
    ...securityHeaders(),
    'content-type': contentType(filePath)
  });
  response.end(content);
}

async function proxyImage(response, sourceUrl) {
  const parsed = new URL(sourceUrl);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    const error = new Error('Unsupported image URL protocol.');
    error.status = 400;
    throw error;
  }

  const upstream = await fetch(parsed, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  });

  if (!upstream.ok) {
    const error = new Error(`Image request failed with HTTP ${upstream.status}`);
    error.status = upstream.status;
    throw error;
  }

  const contentTypeHeader = upstream.headers.get('content-type') ?? 'image/jpeg';
  if (!contentTypeHeader.startsWith('image/')) {
    const error = new Error('URL did not return an image.');
    error.status = 400;
    throw error;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(200, {
    ...securityHeaders(),
    'cache-control': 'public, max-age=86400',
    'content-type': contentTypeHeader
  });
  response.end(body);
}

function securityHeaders() {
  return {
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "connect-src 'self'",
      "frame-src https://vaplayer.ru",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'"
    ].join('; '),
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff'
  };
}

function contentType(filePath) {
  const extension = extname(filePath);
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

async function importVidapiPages(type, pages) {
  const store = await readStore();
  const imported = [];
  const maxPages = Math.min(pages, 10);

  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchVidapiPage(type, page);
    for (const item of data.items ?? []) {
      const normalized = normalizeVidapiItem(type, item);
      if (!normalized.imdbId && !normalized.tmdbId) continue;
      if (!(await isPlayableEmbed(normalized.embedUrl))) continue;
      const result = upsertProviderTitle(store, normalized);
      imported.push({
        catalogKey: result.title.catalogKey,
        created: result.created
      });
    }

    if (page >= Number(data.total_pages ?? page)) break;
  }

  store.providerSyncs.push({
    id: randomUUID(),
    provider: 'vidapi',
    type,
    pages: maxPages,
    imported: imported.length,
    syncedAt: new Date().toISOString()
  });

  await writeStore(store);

  return {
    provider: 'vidapi',
    type,
    pages: maxPages,
    imported: imported.length,
    items: imported
  };
}

async function importVidapiSearch(type, query, pages) {
  if (!query) {
    const error = new Error('query is required.');
    error.status = 400;
    throw error;
  }

  const search = await searchVidapi(type, query, pages);
  const store = await readStore();
  const imported = [];

  for (const normalized of search.items) {
    if (!(await isPlayableEmbed(normalized.embedUrl))) continue;
    const result = upsertProviderTitle(store, normalized);
    imported.push({
      catalogKey: result.title.catalogKey,
      created: result.created
    });
  }

  store.providerSyncs.push({
    id: randomUUID(),
    provider: 'vidapi',
    type,
    query,
    pages,
    imported: imported.length,
    syncedAt: new Date().toISOString()
  });

  await writeStore(store);

  return {
    provider: 'vidapi',
    type,
    query,
    pagesScanned: search.pagesScanned,
    imported: imported.length,
    items: imported
  };
}

async function searchVidapi(type, query, pages) {
  const items = [];
  const normalizedType = ['movie', 'series', 'episode'].includes(type) ? type : 'movie';

  for (let page = 1; page <= pages; page++) {
    const data = await fetchVidapiPage(normalizedType, page);
    for (const item of data.items ?? []) {
      const normalized = normalizeVidapiItem(normalizedType, item);
      const haystack = [
        normalized.title,
        normalized.showTitle,
        normalized.imdbId,
        normalized.tmdbId,
        normalized.categories?.join(' ')
      ].join(' ').toLowerCase();

      if (haystack.includes(query) && (normalized.imdbId || normalized.tmdbId)) {
        if (!(await isPlayableEmbed(normalized.embedUrl))) continue;
        items.push(normalized);
      }
    }

    if (page >= Number(data.total_pages ?? page)) {
      return { provider: 'vidapi', type: normalizedType, query, pagesScanned: page, items };
    }
  }

  return { provider: 'vidapi', type: normalizedType, query, pagesScanned: pages, items };
}

async function fetchVidapiPage(type, page) {
  if (type === 'movie') return fetchLatestMovies(page);
  if (type === 'series') return fetchLatestTvShows(page);
  return fetchLatestEpisodes(page);
}

function normalizeVidapiItem(type, item) {
  if (type === 'movie') return normalizeMovieItem(item);
  if (type === 'series') return normalizeTvShowItem(item);
  return normalizeEpisodeItem(item);
}

function positivePage(value) {
  const page = Number(value ?? 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function requiredParam(url, name) {
  const value = url.searchParams.get(name);
  if (!value) {
    const error = new Error(`${name} is required.`);
    error.status = 400;
    throw error;
  }
  return value;
}

function queryParamsWithout(url, excluded) {
  const excludedSet = new Set(excluded);
  return Object.fromEntries([...url.searchParams.entries()].filter(([key]) => !excludedSet.has(key)));
}

function filterStoreForListing(store) {
  const brokenUrls = new Set(
    (store.externalPageChecks ?? [])
      .filter((check) => check.failedBecause404)
      .map((check) => check.url)
  );

  return {
    ...store,
    titles: (store.titles ?? []).filter((title) => {
      const pages = title.externalPages ?? [];
      return !pages.some((page) => brokenUrls.has(page.url));
    })
  };
}

async function filterPlayableResults(results) {
  const playable = [];

  for (const result of results) {
    const id = result.imdbId || result.tmdbId;
    const embedUrl = result.type === 'series' ? buildTvEmbedUrl(id) : buildMovieEmbedUrl(id);
    if (await isPlayableEmbed(embedUrl)) {
      playable.push(result);
    }
  }

  return playable;
}

async function assertPlayable(embedUrl) {
  if (await isPlayableEmbed(embedUrl)) return;

  const error = new Error('Embed returned 404 or is not playable.');
  error.status = 404;
  throw error;
}

async function getSeriesEpisodes({ imdbId, tmdbId, pages }) {
  if (imdbId) {
    const quickList = await getSeriesEpisodesFromIdList(imdbId);
    if (quickList.length > 0) {
      return {
        imdbId,
        tmdbId,
        pagesScanned: 0,
        episodeCount: quickList.reduce((acc, season) => acc + season.episodes.length, 0),
        seasons: quickList
      };
    }
  }

  const matches = [];
  const seasons = new Map();

  for (let page = 1; page <= pages; page++) {
    const data = await fetchLatestEpisodes(page);

    for (const item of data.items ?? []) {
      const normalized = normalizeEpisodeItem(item);
      const sameImdb = imdbId && normalized.imdbId && normalized.imdbId === imdbId;
      const sameTmdb = tmdbId && normalized.tmdbId && normalized.tmdbId === tmdbId;
      if (!sameImdb && !sameTmdb) continue;

      const season = Number(normalized.season || 1);
      const episode = Number(normalized.episode || 1);
      const seasonEntries = seasons.get(season) ?? [];
      seasonEntries.push({
        season,
        episode,
        title: normalized.title || `Episode ${episode}`,
        airDate: normalized.airDate || '',
        embedUrl: normalized.embedUrl || ''
      });
      seasons.set(season, seasonEntries);
      matches.push(normalized);
    }

    if (page >= Number(data.total_pages ?? page)) break;
  }

  let seasonList = [...seasons.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seasonNumber, episodes]) => ({
      seasonNumber,
      episodes: episodes
        .sort((a, b) => a.episode - b.episode)
        .map((entry) => ({
          season: entry.season,
          episode: entry.episode,
          title: entry.title,
          airDate: entry.airDate,
          embedUrl: entry.embedUrl
        }))
    }));

  if (seasonList.length === 0 && imdbId) {
    seasonList = await getSeriesEpisodesFromIdList(imdbId);
  }

  return {
    imdbId,
    tmdbId,
    pagesScanned: pages,
    episodeCount: matches.length,
    seasons: seasonList
  };
}

async function getSeriesEpisodesFromIdList(imdbId) {
  const cached = episodeListCacheByImdb.get(imdbId);
  if (cached && Date.now() - cached.loadedAt < 60 * 60 * 1000) {
    return cached.seasons;
  }

  try {
    const text = await getEpsImdbText();
    const bySeason = new Map();
    const prefix = `${imdbId}_`;

    for (const line of text.split('\n')) {
      const value = line.trim();
      if (!value.startsWith(prefix)) continue;
      const suffix = value.slice(prefix.length);
      const [seasonRaw, episodeRaw] = suffix.split('x');
      const season = Number(seasonRaw);
      const episode = Number(episodeRaw);
      if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 1 || episode < 1) continue;

      const entries = bySeason.get(season) ?? [];
      entries.push({
        season,
        episode,
        title: `Episode ${episode}`,
        airDate: '',
        embedUrl: buildTvEmbedUrl(imdbId, season, episode)
      });
      bySeason.set(season, entries);
    }

    const seasons = [...bySeason.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, episodes]) => ({
        seasonNumber,
        episodes: episodes.sort((a, b) => a.episode - b.episode)
      }));

    episodeListCacheByImdb.set(imdbId, {
      loadedAt: Date.now(),
      seasons
    });
    return seasons;
  } catch {
    return [];
  }
}

async function getEpsImdbText() {
  const oneHour = 60 * 60 * 1000;
  if (epsImdbRawCache.text && Date.now() - epsImdbRawCache.loadedAt < oneHour) {
    return epsImdbRawCache.text;
  }

  const response = await fetch('https://vidapi.ru/ids/eps_list_imdb.txt', {
    headers: { accept: 'text/plain' }
  });
  if (!response.ok) {
    throw new Error(`VidAPI ids request failed with HTTP ${response.status}`);
  }

  const text = await response.text();
  epsImdbRawCache = {
    loadedAt: Date.now(),
    text
  };
  return text;
}
