FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/matcher/package.json packages/matcher/package.json
COPY packages/searchers/package.json packages/searchers/package.json
RUN bun install
COPY apps/api apps/api
COPY packages/domain packages/domain
COPY packages/db packages/db
COPY packages/engine packages/engine
COPY packages/matcher packages/matcher
COPY packages/searchers packages/searchers
EXPOSE 51111
CMD ["bun", "run", "--filter", "@kauppalista/api", "start"]
