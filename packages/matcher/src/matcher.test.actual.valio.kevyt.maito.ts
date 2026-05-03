import { describe, expect, test } from 'bun:test';
import type { StoreProductCandidate } from '../../domain/src/index';
import {
  ACTUAL_VALIO_KEVYT_MAITO_KESKO_STORE as KESKO_STORE,
  ACTUAL_VALIO_KEVYT_MAITO_QUERY as QUERY,
  ACTUAL_VALIO_KEVYT_MAITO_S_GROUP_STORE as S_GROUP_STORE,
  KeskoSearcher,
  looksLikeRequestedValioKevytMaito,
  SGroupSearcher,
} from '../../searchers/src/index';

import { findBestCandidateMatch, normalizeStoreProductCandidate } from './index';

const KESKO_BROWSER_EXECUTABLE_PATH = process.env.KESKO_BROWSER_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';

const RUN_ACTUAL_MATCHER_TESTS = process.env.RUN_ACTUAL_MATCHER_TESTS === 'true';
const ACTUAL_TEST_TIMEOUT_MS = Number(process.env.ACTUAL_MATCHER_TEST_TIMEOUT_MS ?? 30_000);
const KESKO_ACTUAL_TEST_TIMEOUT_MS = Number(process.env.KESKO_ACTUAL_TEST_TIMEOUT_MS ?? 60_000);
const S_GROUP_ACTUAL_TEST_TIMEOUT_MS = Number(process.env.S_GROUP_ACTUAL_TEST_TIMEOUT_MS ?? ACTUAL_TEST_TIMEOUT_MS);

function formatMoney(value: number | null | undefined) {
  return value == null ? '-' : `${value.toFixed(2)} €`;
}

function printSearchStart(
  sourceLabel: string,
  store: { id: string; name: string },
  timeoutMs: number,
) {
  console.log(`\n[${sourceLabel}] Aloitetaan matcher-live-haku kaupasta ${store.name} (ID ${store.id})`);
  console.log(`[${sourceLabel}] Query: "${QUERY}", timeout ${timeoutMs} ms`);
}

function printCandidateSummary(sourceLabel: string, candidates: StoreProductCandidate[]) {
  const summary = candidates.slice(0, 5).map((candidate, index) => {
    const normalized = normalizeStoreProductCandidate(candidate);

    return {
      '#': index + 1,
      tuote: candidate.name,
      valmistaja: candidate.brand ?? '-',
      hinta: formatMoney(candidate.price),
      brandi: normalized.brand ?? '-',
      koko: normalized.parsedSize?.matchedText ?? '-',
      key: candidate.key,
    };
  });

  console.log(`\n[${sourceLabel}] Matcherin normalisoidut top-ehdokkaat querylle: "${QUERY}"`);
  console.table(summary);
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, '');
}

describe('matcher actual APIs: Valio kevyt maito', () => {
  const liveTest = RUN_ACTUAL_MATCHER_TESTS ? test : test.skip;

  liveTest('matches normalized milk candidates between K-Ruoka and S-kaupat live APIs', async () => {
    const keskoSearcher = new KeskoSearcher({ browserExecutablePath: KESKO_BROWSER_EXECUTABLE_PATH });
    const sGroupSearcher = new SGroupSearcher();

    printSearchStart('K-Ruoka', KESKO_STORE, KESKO_ACTUAL_TEST_TIMEOUT_MS);
    const keskoPromise = keskoSearcher.searchProducts({
      storeId: KESKO_STORE.id,
      query: QUERY,
      limit: 20,
      signal: AbortSignal.timeout(KESKO_ACTUAL_TEST_TIMEOUT_MS),
    });

    printSearchStart('S-kaupat', S_GROUP_STORE, S_GROUP_ACTUAL_TEST_TIMEOUT_MS);
    const sGroupPromise = sGroupSearcher.searchProducts({
      storeId: S_GROUP_STORE.id,
      query: QUERY,
      limit: 20,
      signal: AbortSignal.timeout(S_GROUP_ACTUAL_TEST_TIMEOUT_MS),
    });

    const [keskoResult, sGroupResult] = await Promise.all([keskoPromise, sGroupPromise]);

    printCandidateSummary('K-Ruoka', keskoResult.candidates);
    printCandidateSummary('S-kaupat', sGroupResult.candidates);

    const keskoMilkCandidates = keskoResult.candidates.filter(looksLikeRequestedValioKevytMaito);
    const sGroupMilkCandidates = sGroupResult.candidates.filter(looksLikeRequestedValioKevytMaito);

    expect(keskoMilkCandidates.length).toBeGreaterThan(0);
    expect(sGroupMilkCandidates.length).toBeGreaterThan(0);

    const match = findBestCandidateMatch(keskoMilkCandidates, sGroupMilkCandidates, () => 0);

    expect(match.status).toBe('matched');
    expect(match.reason).toBe('ean');

    const normalizedMatch = normalizeStoreProductCandidate(match.left!);
    expect(match.left?.ean).toBe(match.right?.ean);
    expect(normalizedMatch.brand).toBe('valio');
    expect(normalizedMatch.parsedSize?.standardizedUnit).toBe('ml');
    expect(normalizedMatch.parsedSize?.standardizedTotalQuantity).toBe(1000);
    expect(normalizeComparableText(normalizedMatch.name.comparisonText)).toContain('kevytmaito');
  }, KESKO_ACTUAL_TEST_TIMEOUT_MS + S_GROUP_ACTUAL_TEST_TIMEOUT_MS + 15_000);
});
