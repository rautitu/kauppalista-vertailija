import { Hono } from 'hono';
import { checkDatabaseHealth, createDatabase } from '@kauppalista/db';
import type { HealthStatus, StoreSource } from '@kauppalista/domain';

const app = new Hono();
const db = createDatabase();

function toStoreResponse(store: {
  source: StoreSource;
  externalId: string;
  name: string;
  city?: string | null;
  address?: string | null;
}) {
  return {
    source: store.source,
    storeId: store.externalId,
    storeName: store.name,
    city: store.city ?? null,
    address: store.address ?? null,
  };
}

function parseSource(value: string | undefined): StoreSource | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'k-ruoka' || value === 's-kaupat') {
    return value;
  }

  return undefined;
}

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

app.get('/stores', async (c) => {
  const sourceQuery = c.req.query('source');
  const source = parseSource(sourceQuery);

  if (sourceQuery && !source) {
    return c.json({ error: 'Invalid source. Use k-ruoka or s-kaupat.' }, 400);
  }

  const includeInactive = c.req.query('includeInactive') === 'true';
  const stores = await db.listStores(source, includeInactive);

  return c.json({
    stores: stores.map(toStoreResponse),
  });
});

app.get('/stores/:source', async (c) => {
  const source = parseSource(c.req.param('source'));

  if (!source) {
    return c.json({ error: 'Invalid source. Use k-ruoka or s-kaupat.' }, 400);
  }

  const includeInactive = c.req.query('includeInactive') === 'true';
  const stores = await db.listStores(source, includeInactive);

  return c.json({
    stores: stores.map(toStoreResponse),
  });
});

const port = Number(process.env.PORT ?? 3001);

Bun.serve({
  fetch: app.fetch,
  port,
});

console.log(`API listening on ${port}`);
