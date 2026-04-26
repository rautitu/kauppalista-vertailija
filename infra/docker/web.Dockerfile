FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN bun install
COPY apps/web apps/web
COPY packages/domain packages/domain
RUN bun run --filter @kauppalista/web build
EXPOSE 3000
CMD ["bun", "run", "--filter", "@kauppalista/web", "start"]
