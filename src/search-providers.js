export async function searchImdbSuggestions(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(normalized)}.json`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`IMDb suggestion request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  return (payload.d ?? [])
    .filter((item) => item.id?.startsWith('tt'))
    .map((item) => ({
      provider: 'imdb-suggestions',
      imdbId: item.id,
      tmdbId: '',
      title: item.l ?? '',
      year: Number.isInteger(Number(item.y)) ? Number(item.y) : null,
      type: item.qid === 'tvSeries' || item.q === 'TV series' ? 'series' : 'movie',
      posterUrl: item.i?.imageUrl ?? '',
      description: item.s ?? ''
    }));
}

function normalizeQuery(query) {
  return String(query ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
