FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN bun install
COPY apps/web apps/web
COPY packages/domain packages/domain
ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ARG API_INTERNAL_URL=http://api:51111
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN bun run --filter @kauppalista/web build
EXPOSE 51112
CMD ["bun", "run", "--filter", "@kauppalista/web", "start"]
