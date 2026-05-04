# Media Evaluation Platform

Media Evaluation Platform is a Lerna Soft product for companies that manage film and series catalog workflows.

The first urgent scope is the catalog.

The catalog registers movies, series, and episodes using IMDb/TMDB identifiers from VidAPI and can check whether an external embed page for that ID responds correctly instead of returning `404`.

## Position In Lerna Group

```text
Lerna Group
└── Lerna Soft
    └── Media Evaluation Platform
```

Parent company repository: [`lerna-soft`](https://github.com/lerna-admin/lerna-soft)

## Compliance Boundary

This product must not scrape, download, or redistribute movies from IMDb, StreamIMDb, or other third-party sites without explicit rights.

The current implementation only:

- Stores IMDb and TMDB IDs as external identifiers.
- Separates movies and series.
- Supports episodes as catalog entries.
- Stores categories.
- Imports latest movies, TV shows, and episodes from VidAPI listing endpoints.
- Builds VidAPI embed URLs for the frontend iframe.
- Checks external page availability by HTTP status.
- Does not download media files.

## Local Development

```bash
npm install
npm start
```

The API starts on:

```text
http://localhost:4000
```

## Initial Endpoints

```text
GET  /health
GET  /catalog
POST /catalog/categories
POST /catalog/movies
POST /catalog/series
POST /catalog/episodes
GET  /catalog/titles/:id
POST /catalog/external-page-checks
GET  /providers/vidapi/stats
GET  /providers/vidapi/movies/latest?page=1
GET  /providers/vidapi/tvshows/latest?page=1
GET  /providers/vidapi/episodes/latest?page=1
GET  /providers/vidapi/search?q=avengers&type=movie&pages=100
GET  /providers/search?q=avengers
GET  /providers/vidapi/embed/movie?id=tt23779058
GET  /providers/vidapi/embed/tv?id=tt13159924&season=1&episode=1
POST /catalog/import/vidapi/latest-movies
POST /catalog/import/vidapi/latest-tvshows
POST /catalog/import/vidapi/latest-episodes
POST /catalog/import/vidapi/search
POST /catalog/import/manual
POST /catalog/import/search-result
```

## VidAPI Embed Example

```html
<iframe
  src="https://vaplayer.ru/embed/movie/tt23779058"
  width="100%"
  height="100%"
  frameborder="0"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  sandbox="allow-scripts allow-same-origin allow-presentation"
  referrerpolicy="strict-origin-when-cross-origin"
  allowfullscreen
></iframe>
```

The iframe intentionally does not include `allow-popups`, `allow-top-navigation`, or `allow-forms`. This blocks popups and prevents the embedded player from navigating the parent application.
