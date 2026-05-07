import { describe, test } from 'bun:test';
import type { StoreProductCandidate } from '../../domain/src/index';
import {
  ACTUAL_VALIO_KEVYT_MAITO_KESKO_STORE as KESKO_STORE,
  ACTUAL_VALIO_KEVYT_MAITO_S_GROUP_STORE as S_GROUP_STORE,
  KeskoSearcher,
  SGroupSearcher,
} from '../../searchers/src/index';

import { findBestCandidateMatch, normalizeStoreProductCandidate, validateCrossStoreMatch } from './index';

const KESKO_BROWSER_EXECUTABLE_PATH = process.env.KESKO_BROWSER_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';

const RUN_ACTUAL_MATCHER_TESTS = process.env.RUN_ACTUAL_MATCHER_TESTS === 'true';
const ACTUAL_TEST_TIMEOUT_MS = Number(process.env.ACTUAL_MATCHER_TEST_TIMEOUT_MS ?? 30_000);
const KESKO_ACTUAL_TEST_TIMEOUT_MS = Number(process.env.KESKO_ACTUAL_TEST_TIMEOUT_MS ?? 60_000);
const S_GROUP_ACTUAL_TEST_TIMEOUT_MS = Number(process.env.S_GROUP_ACTUAL_TEST_TIMEOUT_MS ?? ACTUAL_TEST_TIMEOUT_MS);

const QUERIES = [
  'tuuti 200 ml',
  'ehrmann maitorahka',
  'rypsiöljy keiju 1l',
  'jauhoinen peruna',
  'rexona miesten deodorantti',
] as const;

const WAIT_BETWEEN_QUERIES_MS = Number(process.env.ACTUAL_MATCHER_WAIT_BETWEEN_QUERIES_MS ?? 5_000);

function formatMoney(value: number | null | undefined) {
  return value == null ? '-' : `${value.toFixed(2)} €`;
}

function printSearchStart(
  sourceLabel: string,
  store: { id: string; name: string },
  query: string,
  timeoutMs: number,
) {
  console.log(`\n[${sourceLabel}] Aloitetaan haku kaupasta ${store.name} (ID ${store.id})`);
  console.log(`[${sourceLabel}] Query: "${query}", timeout ${timeoutMs} ms`);
}

function printCandidateSummary(sourceLabel: string, query: string, candidates: StoreProductCandidate[]) {
  const summary = candidates.slice(0, 5).map((candidate, index) => {
    const normalized = normalizeStoreProductCandidate(candidate);

    return {
      '#': index + 1,
      score: candidate.searchScore,
      tuote: candidate.name,
      valmistaja: candidate.brand ?? '-',
      ean: candidate.ean ?? '-',
      koko: normalized.parsedSize?.matchedText ?? '-',
      hinta: formatMoney(candidate.price),
      key: candidate.key,
    };
  });

  console.log(`\n[${sourceLabel}] Top 5 querylle: "${query}"`);
  console.table(summary);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printMatchSummary(query: string, match: ReturnType<typeof findBestCandidateMatch>) {
  console.log(`\n[Matcher] Query: "${query}"`);
  console.log('[Matcher] Paras löydetty pari:', {
    status: match.status,
    reason: match.reason,
    score: match.score,
    confidence: match.confidence,
    confidenceLabel: match.confidenceLabel,
    left: match.left
      ? {
          source: match.left.source,
          productId: match.left.productId,
          name: match.left.name,
          brand: match.left.brand,
          ean: match.left.ean,
          key: match.left.key,
        }
      : null,
    right: match.right
      ? {
          source: match.right.source,
          productId: match.right.productId,
          name: match.right.name,
          brand: match.right.brand,
          ean: match.right.ean,
          key: match.right.key,
        }
      : null,
    reasoning: match.reasoning,
  });

  if (match.left && match.right) {
    const validation = validateCrossStoreMatch(match.left, match.right);

    console.log('[Matcher] Cross-store validation:', {
      status: validation.status,
      reason: validation.reason,
      confidence: validation.confidence,
      details: validation.details,
    });
  } else {
    console.log('[Matcher] Cross-store validation skipped: pair incomplete');
  }
}

describe('matcher actual APIs: cross-store query smoke test', () => {
  const liveTest = RUN_ACTUAL_MATCHER_TESTS ? test : test.skip;

  liveTest('searches five queries from both live APIs and prints matcher output', async () => {
    const keskoSearcher = new KeskoSearcher({ browserExecutablePath: KESKO_BROWSER_EXECUTABLE_PATH });
    const sGroupSearcher = new SGroupSearcher();

    for (const [index, query] of QUERIES.entries()) {
      if (index > 0 && WAIT_BETWEEN_QUERIES_MS > 0) {
        console.log(`\n[Testi] Odotetaan ${WAIT_BETWEEN_QUERIES_MS} ms ennen seuraavaa hakua...`);
        await sleep(WAIT_BETWEEN_QUERIES_MS);
      }

      printSearchStart('K-Ruoka', KESKO_STORE, query, KESKO_ACTUAL_TEST_TIMEOUT_MS);
      const keskoPromise = keskoSearcher.searchProducts({
        storeId: KESKO_STORE.id,
        query,
        limit: 20,
        signal: AbortSignal.timeout(KESKO_ACTUAL_TEST_TIMEOUT_MS),
      });

      printSearchStart('S-kaupat', S_GROUP_STORE, query, S_GROUP_ACTUAL_TEST_TIMEOUT_MS);
      const sGroupPromise = sGroupSearcher.searchProducts({
        storeId: S_GROUP_STORE.id,
        query,
        limit: 20,
        signal: AbortSignal.timeout(S_GROUP_ACTUAL_TEST_TIMEOUT_MS),
      });

      const [keskoResult, sGroupResult] = await Promise.all([keskoPromise, sGroupPromise]);

      printCandidateSummary('K-Ruoka', query, keskoResult.candidates);
      printCandidateSummary('S-kaupat', query, sGroupResult.candidates);

      const match = findBestCandidateMatch(keskoResult.candidates, sGroupResult.candidates, () => 0);
      printMatchSummary(query, match);
    }
  },
  QUERIES.length * (KESKO_ACTUAL_TEST_TIMEOUT_MS + S_GROUP_ACTUAL_TEST_TIMEOUT_MS)
    + Math.max(0, QUERIES.length - 1) * WAIT_BETWEEN_QUERIES_MS
    + 30_000,
  );
});
