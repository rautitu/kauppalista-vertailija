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
