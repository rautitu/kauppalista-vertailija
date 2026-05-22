# Kauppalista-vertailija

Kauppalista-vertailija is a Bun and TypeScript monorepo for comparing the price of a shopping list between K-ruoka and S-kaupat stores. The application fetches product candidates from the store APIs, scores and validates matches, persists comparison runs in PostgreSQL, and exposes a Next.js web UI for running comparisons.

The project is currently an end-to-end MVP rather than only a scaffold. It includes store directory sync, product searchers, deterministic matching, cross-store validation, persisted comparison results, structured logs, and a Docker Compose runtime for local development.

## Current Capabilities

- Select one K-ruoka store and one S-kaupat store from synced store directories.
- Enter a shopping list as free-form search terms.
- Run a comparison immediately through the API and comparison engine.
- Fetch K-ruoka product candidates through a Chromium-backed browser session.
- Fetch S-kaupat product candidates through the S-kaupat GraphQL API.
- Normalize names, brands, package sizes, units, and tokens before scoring.
- Validate K-ruoka and S-kaupat matches against each other to avoid comparing different products.
- Persist stores, canonical input items, product matches, comparison run rows, totals, and search logs in PostgreSQL.
- Show totals, per-item match status, selected products, prices, scores, confidence, and validation reasons in the web UI.
- Emit structured JSON logs for API requests, store sync, product search, matching, persistence, and failures.

## Repository Layout

```txt
apps/
  api/       Hono API served with Bun
  web/       Next.js frontend
  worker/    Store directory sync and long-running worker process
packages/
  db/        PostgreSQL migrations, seed data, and repository functions
  domain/    Shared TypeScript types, Zod schemas, and structured logging helper
  engine/    Comparison orchestration and persistence flow
  matcher/   Product normalization, scoring, and cross-store validation
  searchers/ K-ruoka and S-kaupat store/product integrations
infra/
  docker/    Dockerfiles for api, web, and worker services
```

## Runtime Stack

- Bun 1.3.x
- TypeScript
- Next.js 15 and React 19
- Hono
- PostgreSQL 16
- Playwright Core with Chromium for K-ruoka browser-context requests
- Docker Compose for local service orchestration

## Getting Started

Install dependencies:

```bash
bun install
```

Start the full local stack:

```bash
docker compose up --build
```

The Compose stack starts PostgreSQL, applies migrations, starts the API and web services, and runs the worker store sync before keeping the worker alive.

Services:

- Web: http://localhost:51112
- API health: http://localhost:51111/health
- PostgreSQL: `localhost:51110`

For local development outside Compose, start PostgreSQL first and then initialize the database:

```bash
bun run db:setup
```

`db:setup` runs migrations and refreshes store records through the worker sync path. `db:seed:test` only inserts a small deterministic seed dataset for tests and local fixtures.

## Development Commands

```bash
bun run dev:web       # Next.js dev server on port 51112
bun run dev:api       # Hono API with Bun watch mode on port 51111
bun run dev:worker    # Worker entrypoint
bun run db:migrate    # Apply PostgreSQL migrations
bun run db:setup      # Apply migrations and sync store directories
bun run sync:stores   # Refresh K-ruoka and S-kaupat store records
bun run check         # Type-check all workspace packages
bun run build         # Build all workspace packages
```

## Testing

Run the main checks:

```bash
bun run check
bun run test:domain
bun run test:searchers
bun run test:engine
bun run --filter @kauppalista/api test
bun test apps/web/app/page.test.ts
```

Database and actual external integration tests are available separately and may require PostgreSQL, network access, Chromium, and more time:

```bash
bun run test:db
bun run --filter @kauppalista/searchers test:actual:valio-kevyt-maito
bun run --filter @kauppalista/matcher test:actual:valio-kevyt-maito
bun run --filter @kauppalista/matcher test:actual:cross-store-queries
bun run --filter @kauppalista/engine test:actual:valio-kevyt-maito
bun run --filter @kauppalista/engine test:actual:cross-store-queries
```

## Configuration

Default local values are embedded for the standard Docker Compose setup. The most relevant overrides are:

- `DATABASE_URL`: PostgreSQL connection string. Defaults to `postgresql://kauppalista:kauppalista@localhost:51110/kauppalista` outside Compose.
- `PORT`: API or web service port, depending on the process.
- `NEXT_PUBLIC_API_BASE_URL`: Browser-facing API base URL for the web app. Compose uses `/api` through the Next.js rewrite.
- `API_INTERNAL_URL`: Server-side API URL used by the web container.
- `KESKO_BROWSER_EXECUTABLE_PATH`: Chromium executable used by K-ruoka browser-backed requests. Compose sets this to `/usr/bin/chromium`.
- `KESKO_BROWSER_USER_AGENT`: Optional explicit browser user agent for K-ruoka requests. If omitted, the searcher attempts to derive it from the configured Chromium executable.
- `KESKO_BROWSER_FETCH_TIMEOUT_MS`: Inner timeout for browser-context K-ruoka fetches. Default is 20000.
- `KESKO_STORE_LOOKUP_TIMEOUT_MS`: Timeout for resolving K-ruoka store slugs to store ids. Default is 20000.
- `PRODUCT_SEARCH_TIMEOUT_MS`: Outer per-product search timeout in the comparison engine. Default is 65000.
- `PRODUCT_SEARCH_DELAY_MS`: Delay between item searches in the comparison engine. Default is 500.
- `S_GROUP_PRODUCTS_URL`: Override for the S-kaupat GraphQL endpoint.
- `S_GROUP_STORES_SITEMAP_URL`: Override for the S-kaupat store sitemap.
- `S_GROUP_ENRICH_STORE_PAGES`: Set to `true` to fetch extra S-kaupat store page details during sync.
- `KESKO_STORE_DIRECTORY_FETCH_DETAILS`: Set to `true` to fetch extra K-ruoka store details during sync. Disabled by default to avoid slow or rate-limited syncs.

## Port Policy

Ports reserved for this project should stay in the `5111*` range whenever new network ports are added.

Current reservation:

- PostgreSQL host port: `51110`
- API port: `51111`
- Web port: `51112`

## Data Model

The initial migration creates the core schema:

- `stores`: K-ruoka and S-kaupat store directory rows with internal UUID ids and external store ids.
- `canonical_items`: canonical product inputs. Current comparison requests create deterministic input items from submitted search terms.
- `canonical_item_aliases`: search aliases for canonical items.
- `store_product_matches`: selected product matches per store product.
- `comparison_runs`: selected stores, input list, totals, and timestamps.
- `comparison_run_items`: per-item comparison status and links to selected K and S matches.
- `search_logs`: request and response summaries for product searches.

Store ids in API comparison requests are internal `stores.id` UUIDs returned by `GET /stores`. `externalId` is preserved for integrations and debugging.

## Comparison Flow

1. The web UI sends selected internal store ids and trimmed search terms to `POST /comparison-runs`.
2. The API resolves the selected stores and maps internal ids to external K-ruoka or S-kaupat ids for searchers.
3. The engine builds a query for each input item.
4. K-ruoka and S-kaupat product candidates are fetched for the selected stores.
5. Candidate searches are logged with counts and top-candidate summaries.
6. The matcher scores candidates against the canonical input item.
7. Cross-store validation compares the selected K and S candidates by EAN, brand, package size, and token overlap.
8. The engine persists canonical inputs, product matches, comparison rows, totals, and search logs.
9. The API returns the completed comparison run to the web UI.

Rows can end in `matched`, `ambiguous`, `not_found`, or `mismatch`. Totals include only prices available on the selected row matches.

## API

The API returns JSON and uses camelCase fields.

### `GET /health`

Returns API and database health.

### `GET /stores`

Query parameters:

- `source`: optional `k-ruoka` or `s-kaupat`
- `q`: optional search text. All whitespace-separated tokens must match store name, city, address, or external id.
- `limit`: optional integer from `1` to `100`, default `50`
- `includeInactive`: optional `true`

`GET /stores/:source` accepts the same query parameters except `source` is taken from the path.

Example response:

```json
{
  "stores": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "storeId": "11111111-1111-1111-1111-111111111111",
      "externalId": "k-citymarket-lielahti",
      "source": "k-ruoka",
      "storeName": "K-Citymarket Lielahti",
      "city": "Tampere",
      "address": "Harjuntausta 4"
    }
  ]
}
```

### `GET /canonical-items`

Query parameters:

- `q`: optional search text. All tokens must match canonical item name, brand, category, or alias.
- `limit`: optional integer from `1` to `100`, default `50`

### `POST /canonical-items`

Creates or updates a canonical item and aliases.

```json
{
  "name": "Kevytmaito",
  "brand": "Valio",
  "manufacturer": "Valio",
  "size": 1,
  "unit": "l",
  "category": "milk",
  "aliases": ["kevyt maito"],
  "synonyms": ["maito kevyt"]
}
```

If `id` is omitted, the API creates a deterministic `item-*` id from brand, name, size, and unit.

### `POST /comparison-runs`

Runs a comparison synchronously and returns the persisted run.

```json
{
  "selectedKStoreId": "11111111-1111-1111-1111-111111111111",
  "selectedSStoreId": "22222222-2222-2222-2222-222222222222",
  "searchTerms": ["Valio kevytmaito 1 l", "Banaani"],
  "clientRequestId": "optional-client-generated-id"
}
```

Response status is `201` on success.

### `GET /comparison-runs/:id`

Returns persisted run metadata, input list, totals, item rows, and search log summaries.

### `GET /comparison-runs/:id/results`

Returns the frontend-oriented results payload with totals, item rows, and logs.

## Web UI

The current UI is a single-page comparison workflow:

- searchable K-ruoka and S-kaupat store selectors
- localStorage persistence for selected stores and search terms
- dynamic shopping-list search term inputs
- client-generated request ids
- request timeout scaled by item count
- progress state for validation, submission, item search range, result processing, completion, and failure
- result rows with per-store product details, price, comparison price, score, confidence, and validation reason

## Operational Notes

- K-ruoka product search uses a reusable Chromium session per comparison-run-scoped searcher instance and closes searchers after the run.
- Docker Compose sets `init: true` for API and worker containers to reap child processes created by browser-backed search.
- K-ruoka store sync preserves existing K-ruoka rows if the live directory fetch fails, while S-kaupat sync still proceeds.
- Logs are written to stdout as JSON. This is the primary debugging path for API, engine, matcher, searcher, and worker behavior.
- `search_logs` stores request payloads and response summaries for persisted comparison diagnostics.

## Known Limitations

- Comparison runs are currently synchronous API requests. There is a worker service, but comparison execution is not yet queued.
- Shopping-list input is currently free-form search terms; there is not yet a full canonical item management UI.
- Manual match override, cached match reuse, history browsing, and scheduled refresh workflows are not implemented yet.
- External provider behavior can vary. K-ruoka requests depend on a working Chromium runtime and may need timeout or user-agent tuning in new environments.
- Store directory sync is optimized for local development and current provider behavior, not yet for heavy production scheduling.
