import { describe, expect, test } from 'bun:test';
import { createApiApp } from './app';
import type { ProductSearcher } from '@kauppalista/searchers';

const stores = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    source: 'k-ruoka' as const,
    externalId: 'k-supermarket-keskusta',
    name: 'K-Supermarket Keskusta',
    city: 'Tampere',
    address: 'Hämeenkatu 10',
    postalCode: '33100',
    isActive: true,
    metadata: {},
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    source: 's-kaupat' as const,
    externalId: 'prisma-koivistonkylä',
    name: 'Prisma Koivistonkylä',
    city: 'Tampere',
    address: 'Koivistontie 1',
    postalCode: '33820',
    isActive: true,
    metadata: {},
  },
];

function createFakeDb() {
  const canonicalItems = [
    {
      id: 'item-milk-1l',
      name: 'Kevytmaito',
      brand: 'Valio',
      manufacturer: 'Valio',
      size: 1,
      unit: 'l',
      category: 'milk',
      metadata: { synonyms: ['kevyt maito'] },
      aliases: [{ id: 'alias-1', alias: 'kevyt maito', aliasType: 'spacing' }],
    },
  ];
  const runs = new Map<string, any>();
  const runItems: any[] = [];

  return {
    close: async () => undefined,
    listStores: async (source?: 'k-ruoka' | 's-kaupat') => stores.filter((store) => !source || store.source === source),
    searchStores: async (input: { source?: 'k-ruoka' | 's-kaupat'; query?: string; limit?: number }) => {
      const tokens = (input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return stores
        .filter((store) => !input.source || store.source === input.source)
        .filter((store) => tokens.every((token) => [store.name, store.city, store.address, store.externalId].some((value) => value?.toLowerCase().includes(token))))
        .slice(0, input.limit ?? 50);
    },
    getStoreById: async (id: string) => stores.find((store) => store.id === id) ?? null,
    searchCanonicalItems: async () => canonicalItems,
    createCanonicalItem: async (record: any) => {
      const item = { ...record, aliases: [] };
      canonicalItems.push(item);
      return item;
    },
    addCanonicalItemAlias: async (canonicalItemId: string, alias: string) => {
      const item = canonicalItems.find((entry) => entry.id === canonicalItemId);
      item?.aliases.push({ id: alias, alias, aliasType: 'search' });
      return { id: alias, alias, aliasType: 'search' };
    },
    getCanonicalItemWithAliases: async (id: string) => canonicalItems.find((item) => item.id === id) ?? null,
    createComparisonRun: async (record: any) => {
      runs.set(record.id, {
        ...record,
        items: runItems,
        logs: [],
      });
      return record.id;
    },
    createStoreProductMatch: async () => 'match-id',
    addComparisonRunItem: async (record: any) => {
      runItems.push({ id: `row-${runItems.length + 1}`, ...record });
      return `row-${runItems.length}`;
    },
    createSearchLog: async () => 'log-id',
    getComparisonRunWithItems: async (id: string) => runs.get(id) ?? null,
    query: async () => ({ rows: [] }),
  };
}

function createSearcher(source: 'k-ruoka' | 's-kaupat'): ProductSearcher {
  return {
    source,
    async searchProducts(request) {
      return {
        source,
        storeId: request.storeId,
        query: request.query,
        rawResponse: { source },
        candidates: [
          {
            source,
            storeId: request.storeId,
            productId: `${source}-milk`,
            key: `${source}-milk`,
            ean: null,
            name: 'Valio kevytmaito 1 l',
            brand: 'Valio',
            size: 1,
            unit: 'l',
            price: source === 'k-ruoka' ? 1.59 : 1.49,
            comparisonPrice: source === 'k-ruoka' ? 1.59 : 1.49,
            searchScore: 95,
            rawPayload: {},
          },
        ],
      };
    },
  };
}

function createTestApp() {
  return createApiApp({
    db: createFakeDb() as any,
    checkDatabaseHealth: async () => ({ ok: true as const }),
    kSearcher: createSearcher('k-ruoka'),
    sSearcher: createSearcher('s-kaupat'),
    createRunId: () => 'api-test-run-1',
  });
}

describe('api app', () => {
  test('searches stores with source and wildcard-like q filtering', async () => {
    const response = await createTestApp().request('/stores?source=k-ruoka&q=keskusta&limit=10');
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.stores).toEqual([
      expect.objectContaining({
        id: '11111111-1111-1111-1111-111111111111',
        source: 'k-ruoka',
        storeName: 'K-Supermarket Keskusta',
      }),
    ]);
  });

  test('lists and creates canonical items', async () => {
    const app = createTestApp();
    const listResponse = await app.request('/canonical-items?q=maito');
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).canonicalItems[0]).toEqual(
      expect.objectContaining({
        id: 'item-milk-1l',
        aliases: ['kevyt maito'],
      }),
    );

    const createResponse = await app.request('/canonical-items', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Banaani',
        size: 1,
        unit: 'kg',
        aliases: ['banana'],
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(createResponse.status).toBe(201);
    expect((await createResponse.json()).canonicalItem).toEqual(
      expect.objectContaining({
        id: 'item-banaani-1-kg',
        name: 'Banaani',
        aliases: ['banana'],
      }),
    );
  });

  test('creates and reads comparison run results', async () => {
    const app = createTestApp();
    const createResponse = await app.request('/comparison-runs', {
      method: 'POST',
      body: JSON.stringify({
        selectedKStoreId: stores[0].id,
        selectedSStoreId: stores[1].id,
        searchTerms: ['Valio kevytmaito 1 l'],
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(createResponse.status).toBe(201);
    expect((await createResponse.json()).comparisonRun).toEqual(
      expect.objectContaining({
        id: 'api-test-run-1',
        totals: expect.objectContaining({
          kTotal: 1.59,
          sTotal: 1.49,
        }),
      }),
    );

    const runResponse = await app.request('/comparison-runs/api-test-run-1');
    expect(runResponse.status).toBe(200);
    expect((await runResponse.json()).comparisonRun).toEqual(
      expect.objectContaining({
        id: 'api-test-run-1',
      }),
    );

    const resultsResponse = await app.request('/comparison-runs/api-test-run-1/results');
    expect(resultsResponse.status).toBe(200);
    expect((await resultsResponse.json()).results).toHaveLength(1);
  });
});
