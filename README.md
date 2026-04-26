# kauppalista-vertailija

Vaiheen 1 perustus kauppalista-vertailijalle.

## Sisältö

- Bun workspace -monorepo
- `apps/web` (Next.js)
- `apps/api` (Bun + Hono)
- `apps/worker` (worker-skeleton)
- `packages/domain`, `packages/searchers`, `packages/matcher`, `packages/db`
- Docker Compose palveluille `postgres`, `api`, `web`, `worker`

## Käynnistys

```bash
bun install
docker compose up --build
```

Palvelut:

- Web: http://localhost:3000
- API health: http://localhost:3001/health
- Postgres: `localhost:55432`
