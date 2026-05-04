const VIDAPI_LIST_BASE_URL = 'https://vidapi.ru';
const VIDAPI_PLAYER_BASE_URL = 'https://vaplayer.ru';

export function buildMovieEmbedUrl(id, params = {}) {
  return withQuery(`${VIDAPI_PLAYER_BASE_URL}/embed/movie/${encodeURIComponent(id)}`, params);
}

export function buildTvEmbedUrl(id, season, episode, params = {}) {
  const encodedId = encodeURIComponent(id);
  if (season === undefined || episode === undefined || season === null || episode === null) {
    return withQuery(`${VIDAPI_PLAYER_BASE_URL}/embed/tv/${encodedId}`, params);
  }

  return withQuery(
    `${VIDAPI_PLAYER_BASE_URL}/embed/tv/${encodedId}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`,
    params
  );
}

export async function fetchLatestMovies(page = 1) {
  return fetchJson(`${VIDAPI_LIST_BASE_URL}/movies/latest/page-${page}.json`);
}

export async function fetchLatestTvShows(page = 1) {
  return fetchJson(`${VIDAPI_LIST_BASE_URL}/tvshows/latest/page-${page}.json`);
}

export async function fetchLatestEpisodes(page = 1) {
  return fetchJson(`${VIDAPI_LIST_BASE_URL}/episodes/latest/page-${page}.json`);
}

export async function fetchStats() {
  return fetchJson(`${VIDAPI_LIST_BASE_URL}/imdb/api/?action=stats`);
}

export function normalizeMovieItem(item) {
  return {
    type: 'movie',
    imdbId: cleanText(item.imdb_id),
    tmdbId: stringify(item.tmdb_id),
    title: cleanText(item.title),
    year: normalizeYear(item.year),
    categories: splitGenre(item.genre),
    posterUrl: cleanText(item.poster_url),
    rating: cleanText(item.rating),
    popularity: cleanText(item.popularity),
    embedUrl: cleanText(item.embed_url)
  };
}

export function normalizeTvShowItem(item) {
  return {
    type: 'series',
    imdbId: cleanText(item.imdb_id),
    tmdbId: stringify(item.tmdb_id),
    title: cleanText(item.title),
    year: normalizeYear(item.year),
    categories: splitGenre(item.genre),
    posterUrl: cleanText(item.poster_url),
    rating: cleanText(item.rating),
    popularity: cleanText(item.popularity),
    embedUrl: cleanText(item.embed_url)
  };
}

export function normalizeEpisodeItem(item) {
  return {
    type: 'episode',
    imdbId: cleanText(item.show_imdb_id),
    tmdbId: stringify(item.show_tmdb_id),
    title: cleanText(item.episode_title),
    showTitle: cleanText(item.show_title),
    season: Number(item.season_number),
    episode: Number(item.episode_number),
    airDate: cleanText(item.air_date),
    embedUrl: cleanText(item.embed_url)
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`VidAPI request failed with HTTP ${response.status}`);
  }

  return response.json();
}

function withQuery(url, params) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

function splitGenre(value) {
  return cleanText(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringify(value) {
  return value === undefined || value === null ? '' : String(value);
}

function normalizeYear(value) {
  const year = Number(value);
  return Number.isInteger(year) ? year : null;
}
