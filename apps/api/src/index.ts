import { Hono } from 'hono';
import { checkDatabaseHealth } from '@kauppalista/db';
import type { HealthStatus } from '@kauppalista/domain';

const app = new Hono();

app.get('/', (c) => {
  return c.json({
    service: 'kauppalista-api',
    status: 'ok',
  });
});

app.get('/health', async (c) => {
  const database = await checkDatabaseHealth();
  const payload: HealthStatus = {
    status: database.ok ? 'ok' : 'degraded',
    services: {
      api: 'ok',
      database: database.ok ? 'ok' : 'error',
    },
  };

  return c.json(payload, database.ok ? 200 : 503);
});

const port = Number(process.env.PORT ?? 3001);

Bun.serve({
  fetch: app.fetch,
  port,
});

console.log(`API listening on ${port}`);
