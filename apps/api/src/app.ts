import { Hono } from 'hono';
import { createComparisonEngine } from '@kauppalista/engine';
import { KeskoSearcher, SGroupSearcher, type ProductSearcher } from '@kauppalista/searchers';
import { checkDatabaseHealth, createDatabase, type StoreRecord } from '@kauppalista/db';
import {
  CanonicalItemSchema,
  CreateCanonicalItemRequestSchema,
  CreateComparisonRunRequestSchema,
  type CanonicalItem,
  type HealthStatus,
  type StoreSource,
} from '@kauppalista/domain';

type Database = ReturnType<typeof createDatabase>;

export type ApiDependencies = {
  db?: Database;
  checkDatabaseHealth?: typeof checkDatabaseHealth;
  kSearcher?: ProductSearcher;
  sSearcher?: ProductSearcher;
  createRunId?: () => string;
};

function toStoreResponse(store: {
  id?: string;
  source: StoreSource;
  externalId: string;
  name: string;
  city?: string | null;
  address?: string | null;
}) {
  return {
    id: store.id,
    source: store.source,
    storeId: store.id ?? store.externalId,
    externalId: store.externalId,
    storeName: store.name,
    city: store.city ?? null,
    address: store.address ?? null,
  };
}

function toCanonicalItemResponse(item: {
  id: string;
  name: string;
  brand?: string | null;
  manufacturer?: string | null;
  size?: number | null;
  unit?: string | null;
  category?: string | null;
  metadata?: Record<string, unknown>;
  aliases?: Array<{ alias: string }>;
}) {
  const metadata = item.metadata ?? {};
  return {
    id: item.id,
    name: item.name,
    brand: item.brand ?? null,
    manufacturer: item.manufacturer ?? null,
    size: item.size ?? null,
    unit: item.unit ?? null,
    category: item.category ?? null,
    synonyms: Array.isArray(metadata.synonyms) ? metadata.synonyms.filter((value): value is string => typeof value === 'string') : [],
    aliases: item.aliases?.map((alias) => alias.alias) ?? [],
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

function parseLimit(value: string | undefined, fallback = 50) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return Math.min(parsed, 100);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toInputCanonicalItems(searchTerms: string[]): CanonicalItem[] {
  return searchTerms.map((term, index) =>
    CanonicalItemSchema.parse({
      id: `input-${slugify(term) || `item-${index + 1}`}`,
      name: term,
      brand: null,
      manufacturer: null,
      size: null,
      unit: null,
      category: null,
      synonyms: [],
      aliases: [],
    }),
  );
}

async function getStore(db: Database, id: string, expectedSource: StoreSource) {
  const store = await db.getStoreById(id);
  if (!store || store.source !== expectedSource) {
    return null;
  }

  return store;
}

function toDomainStore(store: StoreRecord) {
  return {
    source: store.source,
    storeId: store.id,
    storeName: store.name,
    city: store.city ?? null,
    address: store.address ?? null,
  };
}

function createStoreIdMappedSearcher(searcher: ProductSearcher, store: StoreRecord): ProductSearcher {
  return {
    source: searcher.source,
    async searchProducts(request) {
      const result = await searcher.searchProducts({
        ...request,
        storeId: store.externalId,
      });

      return {
        ...result,
        storeId: store.id,
        candidates: result.candidates.map((candidate) => ({
          ...candidate,
          storeId: store.id,
        })),
      };
    },
  };
}

function mapPersistedRun(run: Awaited<ReturnType<Database['getComparisonRunWithItems']>>) {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    selectedKStoreId: run.selectedKStoreId,
    selectedSStoreId: run.selectedSStoreId,
    inputShoppingList: run.inputShoppingList,
    totals: run.totals,
    items: run.items,
    logs: run.logs,
  };
}

export function createApiApp(deps: ApiDependencies = {}) {
  const app = new Hono();
  const db = deps.db ?? createDatabase();
  const healthcheck = deps.checkDatabaseHealth ?? checkDatabaseHealth;

  app.get('/', (c) => {
    return c.json({
      service: 'kauppalista-api',
      status: 'ok',
    });
  });

  app.get('/health', async (c) => {
    const database = await healthcheck();
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
    const limit = parseLimit(c.req.query('limit'));

    if (sourceQuery && !source) {
      return c.json({ error: 'Invalid source. Use k-ruoka or s-kaupat.' }, 400);
    }

    if (limit === null) {
      return c.json({ error: 'Invalid limit. Use an integer from 1 to 100.' }, 400);
    }

    const includeInactive = c.req.query('includeInactive') === 'true';
    const q = c.req.query('q')?.trim();
    const stores = q
      ? await db.searchStores({ source, query: q, includeInactive, limit })
      : await db.listStores(source, includeInactive);

    return c.json({
      stores: stores.slice(0, limit).map(toStoreResponse),
    });
  });

  app.get('/stores/:source', async (c) => {
    const source = parseSource(c.req.param('source'));
    const limit = parseLimit(c.req.query('limit'));

    if (!source) {
      return c.json({ error: 'Invalid source. Use k-ruoka or s-kaupat.' }, 400);
    }

    if (limit === null) {
      return c.json({ error: 'Invalid limit. Use an integer from 1 to 100.' }, 400);
    }

    const includeInactive = c.req.query('includeInactive') === 'true';
    const q = c.req.query('q')?.trim();
    const stores = q
      ? await db.searchStores({ source, query: q, includeInactive, limit })
      : await db.listStores(source, includeInactive);

    return c.json({
      stores: stores.slice(0, limit).map(toStoreResponse),
    });
  });

  app.get('/canonical-items', async (c) => {
    const limit = parseLimit(c.req.query('limit'));
    if (limit === null) {
      return c.json({ error: 'Invalid limit. Use an integer from 1 to 100.' }, 400);
    }

    const items = await db.searchCanonicalItems({ query: c.req.query('q')?.trim(), limit });
    return c.json({
      canonicalItems: items.map(toCanonicalItemResponse),
    });
  });

  app.post('/canonical-items', async (c) => {
    const parsed = CreateCanonicalItemRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid canonical item request.', details: parsed.error.flatten() }, 400);
    }

    const request = parsed.data;
    const id = request.id ?? `item-${slugify([request.brand, request.name, request.size, request.unit].filter(Boolean).join(' '))}`;
    const item = await db.createCanonicalItem({
      id,
      name: request.name,
      brand: request.brand ?? null,
      manufacturer: request.manufacturer ?? null,
      size: request.size ?? null,
      unit: request.unit ?? null,
      category: request.category ?? null,
      metadata: {
        synonyms: request.synonyms,
      },
    });

    for (const alias of [...request.aliases, ...request.synonyms]) {
      await db.addCanonicalItemAlias(item.id, alias);
    }

    const created = await db.getCanonicalItemWithAliases(item.id);
    return c.json({ canonicalItem: toCanonicalItemResponse(created ?? { ...item, aliases: [] }) }, 201);
  });

  app.post('/comparison-runs', async (c) => {
    const parsed = CreateComparisonRunRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid comparison run request.', details: parsed.error.flatten() }, 400);
    }

    const request = parsed.data;
    const [kStore, sStore] = await Promise.all([
      getStore(db, request.selectedKStoreId, 'k-ruoka'),
      getStore(db, request.selectedSStoreId, 's-kaupat'),
    ]);

    if (!kStore) {
      return c.json({ error: 'selectedKStoreId was not found for k-ruoka.' }, 404);
    }

    if (!sStore) {
      return c.json({ error: 'selectedSStoreId was not found for s-kaupat.' }, 404);
    }

    const engine = createComparisonEngine({
      db,
      kSearcher: createStoreIdMappedSearcher(deps.kSearcher ?? new KeskoSearcher(), kStore),
      sSearcher: createStoreIdMappedSearcher(deps.sSearcher ?? new SGroupSearcher(), sStore),
      createRunId: deps.createRunId,
    });
    const result = await engine.runComparison({
      selectedKStore: toDomainStore(kStore),
      selectedSStore: toDomainStore(sStore),
      shoppingList: toInputCanonicalItems(request.searchTerms),
    });

    return c.json({ comparisonRun: result.comparisonRun }, 201);
  });

  app.get('/comparison-runs/:id', async (c) => {
    const run = mapPersistedRun(await db.getComparisonRunWithItems(c.req.param('id')));
    if (!run) {
      return c.json({ error: 'Comparison run not found.' }, 404);
    }

    return c.json({ comparisonRun: run });
  });

  app.get('/comparison-runs/:id/results', async (c) => {
    const run = mapPersistedRun(await db.getComparisonRunWithItems(c.req.param('id')));
    if (!run) {
      return c.json({ error: 'Comparison run not found.' }, 404);
    }

    return c.json({
      comparisonRunId: run.id,
      totals: run.totals,
      results: run.items,
      logs: run.logs,
    });
  });

  return app;
}
