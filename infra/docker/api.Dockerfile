FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
RUN bun install
COPY apps/api apps/api
COPY packages/domain packages/domain
COPY packages/db packages/db
EXPOSE 3001
CMD ["bun", "run", "--filter", "@kauppalista/api", "start"]
