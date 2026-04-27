FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/searchers/package.json packages/searchers/package.json
COPY packages/matcher/package.json packages/matcher/package.json
RUN bun install
COPY apps/worker apps/worker
COPY packages/domain packages/domain
COPY packages/db packages/db
COPY packages/searchers packages/searchers
COPY packages/matcher packages/matcher
CMD ["bun", "run", "--filter", "@kauppalista/worker", "start"]
