import { randomUUID } from 'node:crypto';

const IMDB_ID_PATTERN = /^tt\d{7,10}$/;
const TMDB_ID_PATTERN = /^\d+$/;
const TITLE_TYPES = new Set(['movie', 'series', 'episode']);
const TITLE_STATUSES = new Set(['draft', 'active', 'blocked', 'archived']);

export function assertImdbId(imdbId) {
  if (!IMDB_ID_PATTERN.test(imdbId)) {
    throw badRequest('Invalid IMDb title ID. Expected format like tt15740736.');
  }
}

export function assertCatalogIdentifier({ imdbId, tmdbId }) {
  if (imdbId && IMDB_ID_PATTERN.test(imdbId)) return;
  if (tmdbId && TMDB_ID_PATTERN.test(tmdbId)) return;
  throw badRequest('A valid IMDb ID or TMDB ID is required.');
}

export function createCategory(store, input) {
  const name = cleanText(input.name);
  if (!name) throw badRequest('Category name is required.');

  const slug = slugify(name);
  const existing = store.categories.find((category) => category.slug === slug);
  if (existing) return existing;

  const category = {
    id: randomUUID(),
    name,
    slug,
    createdAt: new Date().toISOString()
  };

  store.categories.push(category);
  return category;
}

export function createTitle(store, input, type) {
  if (!TITLE_TYPES.has(type)) throw badRequest('Unsupported title type.');

  const imdbId = cleanText(input.imdbId);
  const tmdbId = cleanText(input.tmdbId);
  assertCatalogIdentifier({ imdbId, tmdbId });

  const season = normalizeOptionalPositiveInteger(input.season, 'season');
  const episode = normalizeOptionalPositiveInteger(input.episode, 'episode');
  const catalogKey = buildCatalogKey(type, imdbId, tmdbId, season, episode);
  const existing = store.titles.find((title) => title.catalogKey === catalogKey);
  if (existing) throw conflict(`Title ${catalogKey} already exists.`);

  const status = input.status ?? 'draft';
  if (!TITLE_STATUSES.has(status)) throw badRequest('Unsupported title status.');

  const categorySlugs = Array.isArray(input.categories)
    ? input.categories.map((value) => slugify(String(value))).filter(Boolean)
    : [];

  const title = {
    id: randomUUID(),
    catalogKey,
    type,
    imdbId,
    tmdbId,
    title: cleanText(input.title),
    showTitle: cleanText(input.showTitle),
    originalTitle: cleanText(input.originalTitle),
    year: normalizeYear(input.year),
    season,
    episode,
    categories: categorySlugs,
    metadata: normalizeMetadata(input.metadata),
    externalPages: normalizeExternalPages(input.externalPages),
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.titles.push(title);
  return title;
}

export function upsertProviderTitle(store, input) {
  const type = input.type;
  if (!TITLE_TYPES.has(type)) throw badRequest('Unsupported title type.');

  const imdbId = cleanText(input.imdbId);
  const tmdbId = cleanText(input.tmdbId);
  assertCatalogIdentifier({ imdbId, tmdbId });

  const season = normalizeOptionalPositiveInteger(input.season, 'season');
  const episode = normalizeOptionalPositiveInteger(input.episode, 'episode');
  const catalogKey = buildCatalogKey(type, imdbId, tmdbId, season, episode);
  const now = new Date().toISOString();
  const categorySlugs = Array.isArray(input.categories)
    ? input.categories.map((value) => slugify(String(value))).filter(Boolean)
    : [];

  for (const categoryName of input.categories ?? []) {
    createCategory(store, { name: categoryName });
  }

  const title = {
    id: randomUUID(),
    catalogKey,
    type,
    imdbId,
    tmdbId,
    title: cleanText(input.title),
    showTitle: cleanText(input.showTitle),
    originalTitle: '',
    year: normalizeProviderYear(input.year),
    season,
    episode,
    categories: categorySlugs,
    metadata: {
      provider: 'vidapi',
      posterUrl: cleanText(input.posterUrl),
      rating: cleanText(input.rating),
      popularity: cleanText(input.popularity),
      airDate: cleanText(input.airDate)
    },
    externalPages: input.embedUrl ? [{ label: 'vidapi', url: input.embedUrl }] : [],
    status: 'draft',
    createdAt: now,
    updatedAt: now
  };

  const index = store.titles.findIndex((entry) => entry.catalogKey === catalogKey);
  if (index === -1) {
    store.titles.push(title);
    return { title, created: true };
  }

  const existing = store.titles[index];
  const updated = {
    ...existing,
    ...title,
    id: existing.id,
    status: existing.status,
    createdAt: existing.createdAt,
    updatedAt: now
  };

  store.titles[index] = updated;
  return { title: updated, created: false };
}

export async function checkExternalPage(store, input) {
  const imdbId = cleanText(input.imdbId);
  const tmdbId = cleanText(input.tmdbId);
  assertCatalogIdentifier({ imdbId, tmdbId });

  const title = store.titles.find((entry) => {
    if (imdbId) return entry.imdbId === imdbId;
    return entry.tmdbId === tmdbId;
  });
  if (!title) throw notFound(`Title ${imdbId || tmdbId} is not in catalog.`);

  const externalUrl = cleanText(input.url);
  if (!externalUrl) throw badRequest('url is required.');
  assertHttpUrl(externalUrl);

  const result = await fetchStatus(externalUrl);
  const check = {
    id: randomUUID(),
    imdbId: title.imdbId,
    tmdbId: title.tmdbId,
    url: externalUrl,
    ok: result.ok,
    statusCode: result.statusCode,
    failedBecause404: result.statusCode === 404,
    checkedAt: new Date().toISOString()
  };

  store.externalPageChecks.push(check);
  return check;
}

export function badRequest(message) {
  return httpError(400, message);
}

export function notFound(message) {
  return httpError(404, message);
}

function conflict(message) {
  return httpError(409, message);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeYear(value) {
  if (value === undefined || value === null || value === '') return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1888 || year > 2200) {
    throw badRequest('Invalid year.');
  }
  return year;
}

function normalizeProviderYear(value) {
  if (value === undefined || value === null || value === '') return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1888 && year <= 2200 ? year : null;
}

function normalizeOptionalPositiveInteger(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw badRequest(`${fieldName} must be a positive integer.`);
  }
  return number;
}

function buildCatalogKey(type, imdbId, tmdbId, season, episode) {
  const identifier = imdbId ? `imdb:${imdbId}` : `tmdb:${tmdbId}`;
  if (type !== 'episode') return `${type}:${identifier}`;
  if (!season || !episode) throw badRequest('Episodes require season and episode.');
  return `${type}:${identifier}:s${season}:e${episode}`;
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('metadata must be an object.');
  }
  return value;
}

function normalizeExternalPages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest('externalPages must be an array.');

  return value.map((page) => {
    if (typeof page !== 'object' || page === null) {
      throw badRequest('Each external page must be an object.');
    }

    const label = cleanText(page.label);
    const url = cleanText(page.url);
    if (!label || !url) throw badRequest('Each external page requires label and url.');
    assertHttpUrl(url);

    return { label, url };
  });
}

function assertHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('Invalid URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw badRequest('Only http and https URLs are supported.');
  }
}

async function fetchStatus(url) {
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (head.status !== 405) {
      return { ok: head.ok, statusCode: head.status };
    }
  } catch {
    // Some external pages block HEAD. Fall back to GET and only inspect status.
  }

  const get = await fetch(url, { method: 'GET', redirect: 'follow' });
  return { ok: get.ok, statusCode: get.status };
}
