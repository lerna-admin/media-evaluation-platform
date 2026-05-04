# Media Evaluation Platform Work Plan

## Product Goal

Build a controlled catalog for movies, series, and episodes used by the business workflows with cinema companies.

The urgent business problem is that titles are accessed through external URLs without a controlled catalog, and some pages can fail or return `404`. The first system must know which IMDb/TMDB IDs exist in the VidAPI catalog and whether the external embed page for each ID is reachable.

## Non-Negotiable Boundary

Do not implement movie downloads from IMDb, StreamIMDb, or other third-party sites unless the business has explicit legal rights and a licensed technical source.

For now, use the VidAPI listing and embed endpoints delivered by the client. Official IMDb metadata ingestion can be evaluated later if the product needs direct IMDb licensing.

Sources:

- https://developer.imdb.com/non-commercial-datasets/
- https://developer.imdb.com/documentation/api-documentation/getting-access/

## Repository Role

This repository is the product parent and initial implementation repository. If the product grows, implementation can be split later:

```text
media-evaluation-platform
├── media-catalog-api
├── media-player-web
├── media-evaluation-web
└── media-reporting
```

## Phase 1: Controlled Catalog

Objective: create a catalog for movies and series using IMDb IDs.

Scope:

- Create categories.
- Register movies by IMDb ID.
- Register series by IMDb ID.
- Register seasons and episodes later.
- Import latest movies, TV shows, and episodes from VidAPI.
- Store title type: movie, series, episode.
- Store title status: draft, active, blocked, archived.
- Store metadata fields that can be manually entered or imported from licensed providers.
- Check external page availability for an IMDb ID without downloading media.

Acceptance criteria:

- A title can be created with an IMDb ID such as `tt15740736`.
- Movies and series are separated.
- Categories can be attached to titles.
- The API rejects invalid IMDb IDs.
- The API can verify that an external page does not return `404`.
- The API can build VidAPI embed URLs for movie and TV playback pages.

## Phase 2: Safe Playback Layer

Objective: replace unsafe third-party embeds with a controlled playback layer after the catalog exists.

Scope:

- Store authorized playback assets.
- Attach a playback URL to a catalog title only when the business has rights.
- Avoid automatic downloads from unauthorized third-party sources.
- Support internal player URLs, signed URLs, or approved streaming providers.

Acceptance criteria:

- A title without authorized playback asset cannot be played.
- A title with an authorized asset returns a controlled playback configuration.
- No StreamIMDb or third-party phishing embed is required.

## Phase 3: Evaluation Layer

Objective: support review workflows for IMDb coverage and rating correction analysis.

Scope:

- Create evaluation tasks per title.
- Track evaluator, status, notes, evidence, and decision.
- Track IMDb presence and correction needs.
- Build review queues by category, company, title type, and priority.

Acceptance criteria:

- Evaluators can create review records for titles.
- Each review has status and audit trail.
- Titles can be marked as missing, incorrect, pending correction, or resolved.

## Phase 4: Reporting

Objective: produce operational and client-facing reports.

Scope:

- Catalog coverage reports.
- IMDb presence reports.
- Rating correction reports.
- Evaluator productivity.
- Client/company dashboards.

Acceptance criteria:

- Reports can be filtered by company, date range, title type, category, and status.

## Immediate Implementation

The first implementation in this repo includes:

- A Node.js API without external dependencies.
- JSON file storage for initial iteration.
- Catalog endpoints.
- VidAPI listing endpoints.
- VidAPI import endpoints.
- VidAPI embed URL builder endpoints.
- External page availability checks.
- IMDb ID validation.

This is intentionally simple so the workflow can be validated before choosing the final production stack.

## Current Technical Limitation

The initial API uses JSON file storage for speed. Imports should be run one at a time because concurrent writes can overwrite each other.

Before production, replace JSON storage with PostgreSQL and transactional writes.
