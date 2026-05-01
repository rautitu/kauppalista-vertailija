import { describe, expect, test } from 'bun:test';
import type { StoreProductCandidate } from '@kauppalista/domain';

// Live network tests are opt-in because external store APIs are flaky and rely
// on network/browser behavior that may vary by environment.

import { KeskoSearcher, SGroupSearcher } from './index';

const RUN_ACTUAL_SEARCHER_TESTS = process.env.RUN_ACTUAL_SEARCHER_TESTS === 'true';
const ACTUAL_TEST_TIMEOUT_MS = Number(process.env.ACTUAL_SEARCHER_TEST_TIMEOUT_MS ?? 30_000);
const KESKO_ACTUAL_TEST_TIMEOUT_MS = Number(process.env.KESKO_ACTUAL_SEARCHER_TEST_TIMEOUT_MS ?? 60_000);
const S_GROUP_ACTUAL_TEST_TIMEOUT_MS = Number(process.env.S_GROUP_ACTUAL_SEARCHER_TEST_TIMEOUT_MS ?? ACTUAL_TEST_TIMEOUT_MS);
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

function formatMoney(value: number | null | undefined) {
  return value == null ? '-' : `${value.toFixed(2)} €`;
}

function printCandidateSummary(sourceLabel: string, candidates: StoreProductCandidate[]) {
  const summary = candidates.slice(0, 5).map((candidate, index) => ({
    '#': index + 1,
    tuote: candidate.name,
    valmistaja: candidate.brand ?? '-',
    hinta: formatMoney(candidate.price),
    vertailuhinta: formatMoney(candidate.comparisonPrice),
  }));

  console.log(`\n[${sourceLabel}] Hakutulokset querylle: "${QUERY}"`);
  console.table(summary);
}

describe('product searchers actual APIs: Valio kevyt maito', () => {
  const liveTest = RUN_ACTUAL_SEARCHER_TESTS ? test : test.skip;

  liveTest('finds Valio kevyt maito from K-Ruoka live API', async () => {
    const searcher = new KeskoSearcher();
    const result = await searcher.searchProducts({
      storeId: 'k-citymarket-lielahti',
      query: QUERY,
      limit: 20,
      signal: AbortSignal.timeout(KESKO_ACTUAL_TEST_TIMEOUT_MS),
    });

    printCandidateSummary('K-Ruoka', result.candidates);

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.some(looksLikeRequestedValioKevytMaito)).toBe(true);
  }, KESKO_ACTUAL_TEST_TIMEOUT_MS + 5_000);

  liveTest('finds Valio kevyt maito from S-kaupat live API', async () => {
    const searcher = new SGroupSearcher();
    const result = await searcher.searchProducts({
      storeId: 'prisma-koivistonkylä',
      query: QUERY,
      limit: 20,
      signal: AbortSignal.timeout(S_GROUP_ACTUAL_TEST_TIMEOUT_MS),
    });

    printCandidateSummary('S-kaupat', result.candidates);

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.some(looksLikeRequestedValioKevytMaito)).toBe(true);
  }, S_GROUP_ACTUAL_TEST_TIMEOUT_MS + 5_000);
});
