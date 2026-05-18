import { createApiApp } from './app';

const port = Number(process.env.PORT ?? 51111);

Bun.serve({
  fetch: createApiApp().fetch,
  port,
});

console.log(`API listening on ${port}`);
