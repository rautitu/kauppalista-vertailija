import { describe, expect, test } from 'bun:test';

// Live network tests are opt-in because external store APIs are flaky and may
// block headless traffic (for example K-Ruoka currently returns HTTP 403 here).

import { KeskoSearcher, SGroupSearcher } from './index';

const RUN_ACTUAL_SEARCHER_TESTS = process.env.RUN_ACTUAL_SEARCHER_TESTS === 'true';
const ACTUAL_TEST_TIMEOUT_MS = Number(process.env.ACTUAL_SEARCHER_TEST_TIMEOUT_MS ?? 30_000);
const QUERY = 'Valio kevyt maito';

function normalize(value: string | null | undefined) {
  return value
    ?.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim() ?? '';
}

function looksLikeRequestedValioKevytMaito(candidate: {
  name: string;
  brand?: string | null;
}) {
  const name = normalize(candidate.name);
  const brand = normalize(candidate.brand);

  return brand.includes('valio') && name.includes('kevyt') && name.includes('maito');
}

describe('product searchers actual APIs: Valio kevyt maito', () => {
  const liveTest = RUN_ACTUAL_SEARCHER_TESTS ? test : test.skip;

  liveTest('finds Valio kevyt maito from K-Ruoka live API', async () => {
    const searcher = new KeskoSearcher();
    const result = await searcher.searchProducts({
      storeId: 'k-citymarket-lielahti',
      query: QUERY,
      limit: 20,
      signal: AbortSignal.timeout(ACTUAL_TEST_TIMEOUT_MS),
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.some(looksLikeRequestedValioKevytMaito)).toBe(true);
  }, ACTUAL_TEST_TIMEOUT_MS + 5_000);

  liveTest('finds Valio kevyt maito from S-kaupat live API', async () => {
    const searcher = new SGroupSearcher();
    const result = await searcher.searchProducts({
      storeId: 'prisma-koivistonkylä',
      query: QUERY,
      limit: 20,
      signal: AbortSignal.timeout(ACTUAL_TEST_TIMEOUT_MS),
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.some(looksLikeRequestedValioKevytMaito)).toBe(true);
  }, ACTUAL_TEST_TIMEOUT_MS + 5_000);
});
