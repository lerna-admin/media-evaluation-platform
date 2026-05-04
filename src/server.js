import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { checkExternalPage, createCategory, createTitle, notFound, upsertProviderTitle } from './catalog.js';
import { readStore, writeStore } from './storage.js';
import {
  buildMovieEmbedUrl,
  buildTvEmbedUrl,
  fetchLatestEpisodes,
  fetchLatestMovies,
  fetchLatestTvShows,
  fetchStats,
  normalizeEpisodeItem,
  normalizeMovieItem,
  normalizeTvShowItem
} from './vidapi.js';

const port = Number(process.env.PORT ?? 4000);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const route = `${request.method} ${url.pathname}`;

    if (route === 'GET /health') {
      return json(response, 200, { status: 'ok' });
    }

    if (route === 'GET /catalog') {
      return json(response, 200, await readStore());
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
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
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
