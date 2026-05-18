# kauppalista-vertailija

Phase 1 foundation for the shopping list comparison tool.

## Contents

- Bun workspace monorepo
- `apps/web` (Next.js)
- `apps/api` (Bun + Hono)
- `apps/worker` (worker skeleton)
- `packages/domain`, `packages/searchers`, `packages/matcher`, `packages/db`
- Docker Compose services for `postgres`, `api`, `web`, and `worker`

## Getting started

```bash
bun install
docker compose up --build
```

Services:

- Web: http://localhost:3000
- API health: http://localhost:3001/health
- Postgres: `localhost:51110`

## Port policy

Ports reserved for this project should always follow the `5111*` series whenever new network ports are added.

Current reservation:
- Postgres host port: `51110`

## API contracts

The API returns JSON and uses stable camelCase response fields for frontend state. Store ids in comparison requests are internal `stores.id` UUIDs returned by `GET /stores`; `externalId` is included for display/debugging only.

### `GET /stores`

Query parameters:
- `source`: optional `k-ruoka` or `s-kaupat`
- `q`: optional wildcard-like search text. All whitespace-separated tokens must match store name, city, address, or external id.
- `limit`: optional integer `1..100`, default `50`
- `includeInactive`: optional `true`

Response:

```json
{
  "stores": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "storeId": "11111111-1111-1111-1111-111111111111",
      "externalId": "k-supermarket-keskusta",
      "source": "k-ruoka",
      "storeName": "K-Supermarket Keskusta",
      "city": "Tampere",
      "address": "Hämeenkatu 10"
    }
  ]
}
```

`GET /stores/:source` accepts the same query parameters except `source` is taken from the path.

### `GET /canonical-items`

Query parameters:
- `q`: optional wildcard-like search text. All tokens must match canonical item name, brand, category, or alias.
- `limit`: optional integer `1..100`, default `50`

Response:

```json
{
  "canonicalItems": [
    {
      "id": "item-milk-1l",
      "name": "Kevytmaito",
      "brand": "Valio",
      "manufacturer": "Valio",
      "size": 1,
      "unit": "l",
      "category": "milk",
      "synonyms": ["kevyt maito"],
      "aliases": ["kevyt maito"]
    }
  ]
}
```

### `POST /canonical-items`

Request:

```json
{
  "id": "item-milk-1l",
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

`id` is optional. If omitted, the API creates a deterministic `item-*` id from brand, name, size, and unit.

Response: `201`

```json
{
  "canonicalItem": {
    "id": "item-milk-1l",
    "name": "Kevytmaito",
    "brand": "Valio",
    "manufacturer": "Valio",
    "size": 1,
    "unit": "l",
    "category": "milk",
    "synonyms": ["maito kevyt"],
    "aliases": ["kevyt maito", "maito kevyt"]
  }
}
```

### `POST /comparison-runs`

Request:

```json
{
  "selectedKStoreId": "11111111-1111-1111-1111-111111111111",
  "selectedSStoreId": "22222222-2222-2222-2222-222222222222",
  "searchTerms": ["Valio kevytmaito 1 l", "Banaani"],
  "clientRequestId": "optional-frontend-id"
}
```

`searchTerms` maps directly to the frontend multiline input, one trimmed row per array item. The current backend creates deterministic input canonical item ids from those terms and runs the comparison engine immediately.

Response: `201`

```json
{
  "comparisonRun": {
    "id": "run-...",
    "selectedKStore": { "source": "k-ruoka", "storeId": "...", "storeName": "..." },
    "selectedSStore": { "source": "s-kaupat", "storeId": "...", "storeName": "..." },
    "inputShoppingList": [],
    "matchedRows": [],
    "totals": {
      "kTotal": 0,
      "sTotal": 0,
      "difference": 0,
      "matchedItems": 0,
      "ambiguousItems": 0,
      "missingItems": 0
    },
    "createdAt": "2026-05-18T00:00:00.000Z",
    "updatedAt": "2026-05-18T00:00:00.000Z"
  }
}
```

### `GET /comparison-runs/:id`

Returns persisted run metadata, input list, totals, item rows, and search log summaries:

```json
{
  "comparisonRun": {
    "id": "run-...",
    "selectedKStoreId": "...",
    "selectedSStoreId": "...",
    "inputShoppingList": [],
    "totals": {},
    "items": [],
    "logs": []
  }
}
```

### `GET /comparison-runs/:id/results`

Returns the frontend results payload:

```json
{
  "comparisonRunId": "run-...",
  "totals": {},
  "results": [],
  "logs": []
}
```
