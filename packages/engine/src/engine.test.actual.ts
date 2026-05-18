import { describe, expect, test } from 'bun:test';

import { createDatabase, runMigrations, runSeeds } from '../../db/src/index';
import type { CanonicalItem, Store } from '../../domain/src/index';
import {
  ACTUAL_VALIO_KEVYT_MAITO_KESKO_STORE as KESKO_STORE,
  ACTUAL_VALIO_KEVYT_MAITO_S_GROUP_STORE as S_GROUP_STORE,
  KeskoSearcher,
  looksLikeRequestedValioKevytMaito,
  type ProductSearchRequest,
  type ProductSearcher,
  SGroupSearcher,
} from '../../searchers/src/index';
import { createComparisonEngine } from './index';

const KESKO_BROWSER_EXECUTABLE_PATH = process.env.KESKO_BROWSER_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';

const RUN_ACTUAL_ENGINE_TESTS = process.env.RUN_ACTUAL_ENGINE_TESTS === 'true';
const ACTUAL_TEST_TIMEOUT_MS = Number(process.env.ACTUAL_ENGINE_TEST_TIMEOUT_MS ?? 30_000);
const KESKO_ACTUAL_TEST_TIMEOUT_MS = Number(process.env.KESKO_ACTUAL_TEST_TIMEOUT_MS ?? 60_000);
const S_GROUP_ACTUAL_TEST_TIMEOUT_MS = Number(process.env.S_GROUP_ACTUAL_TEST_TIMEOUT_MS ?? ACTUAL_TEST_TIMEOUT_MS);
const WAIT_BETWEEN_QUERIES_MS = Number(process.env.ACTUAL_ENGINE_WAIT_BETWEEN_QUERIES_MS ?? 2_000);
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://kauppalista:kauppalista@localhost:51110/kauppalista';

const liveTest = RUN_ACTUAL_ENGINE_TESTS ? test : test.skip;

const CROSS_STORE_QUERIES = [
  'tuuti 200 ml',
  'ehrmann maitorahka',
  'rypsiöljy keiju 1l',
  'jauhoinen peruna',
  'rexona miesten deodorantti',
] as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createThrottledSearcher(searcher: ProductSearcher, waitMs: number): ProductSearcher {
  let isFirstSearch = true;

  return {
    source: searcher.source,
    async searchProducts(request) {
      if (!isFirstSearch && waitMs > 0) {
        console.log(`[Engine] Waiting ${waitMs} ms before ${searcher.source} query "${request.query}"`);
        await sleep(waitMs);
      }

      isFirstSearch = false;
      return searcher.searchProducts(request);
    },
  };
}

function createStoreIdMappedSearcher(
  searcher: ProductSearcher,
  storeIdMap: Record<string, string>,
): ProductSearcher {
  return {
    source: searcher.source,
    async searchProducts(request: ProductSearchRequest) {
      const externalStoreId = storeIdMap[request.storeId];
      if (!externalStoreId) {
        throw new Error(`No external store id mapping for ${searcher.source} storeId ${request.storeId}`);
      }

      return searcher.searchProducts({
        ...request,
        storeId: externalStoreId,
      });
    },
  };
}

function createSchemaId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

async function withActualDatabase<T>(prefix: string, callback: (db: ReturnType<typeof createDatabase>) => Promise<T>) {
  const schema = createSchemaId(prefix);
  const db = createDatabase({ connectionString: DATABASE_URL, schema });

  await runMigrations({ connectionString: DATABASE_URL, schema });
  await runSeeds({ connectionString: DATABASE_URL, schema });

  try {
    return await callback(db);
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.close();
  }
}

async function prepareActualStores(db: ReturnType<typeof createDatabase>) {
  await db.syncStores('k-ruoka', [
    {
      externalId: KESKO_STORE.id,
      name: KESKO_STORE.name,
      city: 'Tampere',
      address: null,
      postalCode: null,
      isActive: true,
      metadata: {},
    },
  ]);

  await db.syncStores('s-kaupat', [
    {
      externalId: S_GROUP_STORE.id,
      name: S_GROUP_STORE.name,
      city: 'Tampere',
      address: null,
      postalCode: null,
      isActive: true,
      metadata: {},
    },
  ]);

  const stores = await db.listStores(undefined, true);
  const kStoreRecord = stores.find((store) => store.source === 'k-ruoka' && store.externalId === KESKO_STORE.id);
  const sStoreRecord = stores.find((store) => store.source === 's-kaupat' && store.externalId === S_GROUP_STORE.id);

  if (!kStoreRecord || !sStoreRecord) {
    throw new Error('Failed to prepare actual stores in test schema');
  }

  return {
    selectedKStore: {
      source: 'k-ruoka',
      storeId: kStoreRecord.id,
      storeName: kStoreRecord.name,
      city: kStoreRecord.city ?? null,
      address: kStoreRecord.address ?? null,
    } satisfies Store,
    selectedSStore: {
      source: 's-kaupat',
      storeId: sStoreRecord.id,
      storeName: sStoreRecord.name,
      city: sStoreRecord.city ?? null,
      address: sStoreRecord.address ?? null,
    } satisfies Store,
    storeIdMap: {
      [kStoreRecord.id]: kStoreRecord.externalId,
      [sStoreRecord.id]: sStoreRecord.externalId,
    },
  };
}

function printRowSummary(label: string, row: {
  canonicalItem: { name: string };
  status: string;
  kMatch: { candidate?: { name: string; price: number } } | null;
  sMatch: { candidate?: { name: string; price: number } } | null;
  crossStoreValidation?: { status: string; reason: string };
}) {
  console.log(`\n[Engine] ${label}`);
  console.log({
    item: row.canonicalItem.name,
    status: row.status,
    kCandidate: row.kMatch?.candidate?.name ?? null,
    kPrice: row.kMatch?.candidate?.price ?? null,
    sCandidate: row.sMatch?.candidate?.name ?? null,
    sPrice: row.sMatch?.candidate?.price ?? null,
    validationStatus: row.crossStoreValidation?.status ?? null,
    validationReason: row.crossStoreValidation?.reason ?? null,
  });
}

describe('comparison engine actual APIs', () => {
  liveTest('matches and persists Valio kevyt maito end-to-end with live searchers', async () => {
    await withActualDatabase('test_engine_actual_valio', async (db) => {
      const { selectedKStore, selectedSStore, storeIdMap } = await prepareActualStores(db);
      const engine = createComparisonEngine({
        db,
        now: () => new Date('2026-05-18T12:00:00.000Z'),
        createRunId: () => createSchemaId('actual-engine-valio'),
        kSearcher: createStoreIdMappedSearcher(
          new KeskoSearcher({ browserExecutablePath: KESKO_BROWSER_EXECUTABLE_PATH }),
          storeIdMap,
        ),
        sSearcher: createStoreIdMappedSearcher(new SGroupSearcher(), storeIdMap),
      });

      const shoppingList: CanonicalItem[] = [
        {
          id: 'actual-valio-kevytmaito-1l',
          name: 'Kevytmaito',
          brand: 'Valio',
          manufacturer: 'Valio',
          size: 1,
          unit: 'l',
          category: 'milk',
          synonyms: [],
          aliases: [],
        },
      ];

      const result = await engine.runComparison({ selectedKStore, selectedSStore, shoppingList });
      const row = result.comparisonRun.matchedRows[0];

      printRowSummary('Valio kevyt maito', row);

      expect(result.searchLogs).toHaveLength(2);
      expect(result.searchLogs.every((log) => log.candidateCount > 0)).toBe(true);
      expect(result.comparisonRun.matchedRows).toHaveLength(1);
      expect(row?.status).toBe('matched');
      expect(row?.kMatch?.candidate).toBeDefined();
      expect(row?.sMatch?.candidate).toBeDefined();
      expect(looksLikeRequestedValioKevytMaito(row!.kMatch!.candidate!)).toBe(true);
      expect(looksLikeRequestedValioKevytMaito(row!.sMatch!.candidate!)).toBe(true);
      expect(row?.crossStoreValidation?.status).toBe('matched');
      expect(row?.kMatch?.candidate?.ean).toBe(row?.sMatch?.candidate?.ean);
      expect(result.comparisonRun.totals.matchedItems).toBe(1);

      const persisted = await db.getComparisonRunWithItems(result.comparisonRun.id);
      expect(persisted?.items).toHaveLength(1);
      expect(persisted?.logs).toHaveLength(2);
      expect(persisted?.totals.matchedItems).toBe(1);
    });
  }, KESKO_ACTUAL_TEST_TIMEOUT_MS + S_GROUP_ACTUAL_TEST_TIMEOUT_MS + 20_000);

  liveTest('runs a cross-store query smoke test end-to-end with live searchers', async () => {
    await withActualDatabase('test_engine_actual_smoke', async (db) => {
      const { selectedKStore, selectedSStore, storeIdMap } = await prepareActualStores(db);
      const engine = createComparisonEngine({
        db,
        now: () => new Date('2026-05-18T12:30:00.000Z'),
        createRunId: () => createSchemaId('actual-engine-smoke'),
        kSearcher: createThrottledSearcher(
          createStoreIdMappedSearcher(
            new KeskoSearcher({ browserExecutablePath: KESKO_BROWSER_EXECUTABLE_PATH }),
            storeIdMap,
          ),
          WAIT_BETWEEN_QUERIES_MS,
        ),
        sSearcher: createThrottledSearcher(
          createStoreIdMappedSearcher(new SGroupSearcher(), storeIdMap),
          WAIT_BETWEEN_QUERIES_MS,
        ),
      });

      const shoppingList: CanonicalItem[] = CROSS_STORE_QUERIES.map((query, index) => ({
        id: `actual-cross-store-query-${index + 1}`,
        name: query,
        brand: null,
        manufacturer: null,
        size: null,
        unit: null,
        category: null,
        synonyms: [],
        aliases: [],
      }));

      const result = await engine.runComparison({ selectedKStore, selectedSStore, shoppingList });

      for (const row of result.comparisonRun.matchedRows) {
        printRowSummary('Cross-store smoke', row);
      }

      expect(result.comparisonRun.matchedRows).toHaveLength(CROSS_STORE_QUERIES.length);
      expect(result.searchLogs).toHaveLength(CROSS_STORE_QUERIES.length * 2);
      expect(result.searchLogs.filter((log) => log.candidateCount > 0).length).toBeGreaterThanOrEqual(
        CROSS_STORE_QUERIES.length * 2 - 1,
      );
      expect(
        result.comparisonRun.matchedRows.some(
          (row) => row.status === 'matched' || row.status === 'ambiguous' || row.status === 'mismatch',
        ),
      ).toBe(true);

      const persisted = await db.getComparisonRunWithItems(result.comparisonRun.id);
      expect(persisted?.items).toHaveLength(CROSS_STORE_QUERIES.length);
      expect(persisted?.logs).toHaveLength(CROSS_STORE_QUERIES.length * 2);
    });
  },
  CROSS_STORE_QUERIES.length * (KESKO_ACTUAL_TEST_TIMEOUT_MS + S_GROUP_ACTUAL_TEST_TIMEOUT_MS)
    + Math.max(0, CROSS_STORE_QUERIES.length - 1) * WAIT_BETWEEN_QUERIES_MS
    + 30_000,
  );
});
