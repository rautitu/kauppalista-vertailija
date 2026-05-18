import type {
  ComparisonRun,
  ComparisonRunItem,
  ComparisonRunTotals,
  CrossStoreValidationResult,
  ProductMatch,
  Store,
  CanonicalItem,
  MatchStatus,
  StoreProductCandidate,
} from '../../domain/src/index';
import { ComparisonRunSchema } from '../../domain/src/index';
import type { createDatabase } from '../../db/src/index';
import {
  findBestCandidateMatch,
  validateCrossStoreMatch,
} from '../../matcher/src/index';
import type { ProductSearcher, ProductSearchResult } from '../../searchers/src/index';

export type ComparisonEngineDependencies = {
  db: ReturnType<typeof createDatabase>;
  kSearcher: ProductSearcher;
  sSearcher: ProductSearcher;
  now?: () => Date;
  createRunId?: () => string;
};

export type RunComparisonInput = {
  selectedKStore: Store;
  selectedSStore: Store;
  shoppingList: CanonicalItem[];
};

export type ComparisonSearchLog = {
  source: 'k-ruoka' | 's-kaupat';
  storeId: string;
  query: string;
  candidateCount: number;
  rawResponse: unknown;
};

export type ComparisonEngineResult = {
  comparisonRun: ComparisonRun;
  searchLogs: ComparisonSearchLog[];
};

function buildQuery(item: CanonicalItem) {
  return [item.brand, item.name, item.size, item.unit]
    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
    .join(' ')
    .trim();
}

function mapCandidateToProductMatch(
  item: CanonicalItem,
  candidate: StoreProductCandidate,
  status: MatchStatus,
  score: number,
  confidence: number,
  reason?: string,
): ProductMatch {
  return {
    canonicalItemId: item.id,
    source: candidate.source,
    storeId: candidate.storeId,
    storeProductId: candidate.productId,
    score,
    confidence,
    status,
    candidate,
    reason: reason ?? null,
  };
}

function deriveRowStatus(
  kStatus: MatchStatus,
  sStatus: MatchStatus,
  validation?: CrossStoreValidationResult,
): MatchStatus {
  if (kStatus === 'not_found' || sStatus === 'not_found') {
    if (validation?.status === 'matched') {
      return 'matched';
    }

    if (validation?.reason === 'brand_mismatch' || validation?.reason === 'size_mismatch') {
      return 'mismatch';
    }

    if (kStatus === 'ambiguous' || sStatus === 'ambiguous') {
      return 'ambiguous';
    }

    return 'not_found';
  }

  if (validation?.status === 'matched') {
    return 'matched';
  }

  if (validation?.reason === 'brand_mismatch' || validation?.reason === 'size_mismatch') {
    return 'mismatch';
  }

  if (kStatus === 'ambiguous' || sStatus === 'ambiguous') {
    return 'ambiguous';
  }

  if (validation?.status === 'mismatch') {
    return 'mismatch';
  }

  if (kStatus === 'matched' && sStatus === 'matched') {
    return 'matched';
  }

  return 'mismatch';
}

function createTotals(rows: ComparisonRunItem[]): ComparisonRunTotals {
  const kTotal = rows.reduce((sum, row) => sum + (row.kMatch?.candidate?.price ?? 0), 0);
  const sTotal = rows.reduce((sum, row) => sum + (row.sMatch?.candidate?.price ?? 0), 0);

  return {
    kTotal: Number(kTotal.toFixed(2)),
    sTotal: Number(sTotal.toFixed(2)),
    difference: Number((kTotal - sTotal).toFixed(2)),
    matchedItems: rows.filter((row) => row.status === 'matched').length,
    ambiguousItems: rows.filter((row) => row.status === 'ambiguous').length,
    missingItems: rows.filter((row) => row.status === 'not_found' || row.status === 'mismatch').length,
  };
}

async function persistSearchLog(
  db: ReturnType<typeof createDatabase>,
  runId: string,
  itemId: string,
  log: ComparisonSearchLog,
) {
  await db.createSearchLog({
    comparisonRunId: runId,
    canonicalItemId: itemId,
    source: log.source,
    storeId: log.storeId,
    query: log.query,
    candidateCount: log.candidateCount,
    requestPayload: { query: log.query },
    responsePayload: log.rawResponse,
  });
}

export function createComparisonEngine(deps: ComparisonEngineDependencies) {
  const now = deps.now ?? (() => new Date());
  const createRunId = deps.createRunId ?? (() => `run-${crypto.randomUUID()}`);

  return {
    async runComparison(input: RunComparisonInput): Promise<ComparisonEngineResult> {
      const runId = createRunId();
      const createdAt = now();
      const rows: ComparisonRunItem[] = [];
      const searchLogs: ComparisonSearchLog[] = [];

      for (const item of input.shoppingList) {
        const query = buildQuery(item);
        const [kSearch, sSearch] = await Promise.all([
          deps.kSearcher.searchProducts({ storeId: input.selectedKStore.storeId, query, limit: 10 }),
          deps.sSearcher.searchProducts({ storeId: input.selectedSStore.storeId, query, limit: 10 }),
        ]);

        const itemLogs = [kSearch, sSearch].map((result) => ({
          source: result.source,
          storeId: result.storeId,
          query: result.query,
          candidateCount: result.candidates.length,
          rawResponse: result.rawResponse,
        })) satisfies ComparisonSearchLog[];

        searchLogs.push(...itemLogs);

        const pairMatch = findBestCandidateMatch(kSearch.candidates, sSearch.candidates, () => 0);
        const kBest = pairMatch.left;
        const sBest = pairMatch.right;

        const kStatus: MatchStatus = kBest ? pairMatch.status : 'not_found';
        const sStatus: MatchStatus = sBest ? pairMatch.status : 'not_found';

        const kMatch = kBest
          ? mapCandidateToProductMatch(item, kBest, kStatus, kBest.searchScore, pairMatch.confidence, pairMatch.reason)
          : null;
        const sMatch = sBest
          ? mapCandidateToProductMatch(item, sBest, sStatus, sBest.searchScore, pairMatch.confidence, pairMatch.reason)
          : null;

        const crossStoreValidation = kBest && sBest ? validateCrossStoreMatch(kBest, sBest) : undefined;
        const rowStatus = deriveRowStatus(kMatch?.status ?? 'not_found', sMatch?.status ?? 'not_found', crossStoreValidation);

        rows.push({
          canonicalItem: item,
          kMatch,
          sMatch,
          status: rowStatus,
          crossStoreValidation,
        });
      }

      const totals = createTotals(rows);

      for (const item of input.shoppingList) {
        await deps.db.createCanonicalItem({
          id: item.id,
          name: item.name,
          brand: item.brand ?? null,
          manufacturer: item.manufacturer ?? null,
          size: item.size ?? null,
          unit: item.unit ?? null,
          category: item.category ?? null,
          metadata: {
            synonyms: item.synonyms,
            aliases: item.aliases,
          },
        });
      }

      await deps.db.createComparisonRun({
        id: runId,
        selectedKStoreId: input.selectedKStore.storeId,
        selectedSStoreId: input.selectedSStore.storeId,
        inputShoppingList: input.shoppingList,
        totals,
      });

      for (const [index, row] of rows.entries()) {
        const kMatchId = row.kMatch?.candidate
          ? await deps.db.createStoreProductMatch({
              canonicalItemId: row.canonicalItem.id,
              storeId: row.kMatch.storeId,
              storeProductId: row.kMatch.storeProductId,
              productName: row.kMatch.candidate.name,
              brand: row.kMatch.candidate.brand ?? null,
              size: row.kMatch.candidate.size ?? null,
              unit: row.kMatch.candidate.unit ?? null,
              price: row.kMatch.candidate.price,
              comparisonPrice: row.kMatch.candidate.comparisonPrice ?? null,
              score: row.kMatch.score,
              confidence: row.kMatch.confidence,
              status: row.kMatch.status === 'mismatch' ? 'ambiguous' : row.kMatch.status,
              rawPayload: row.kMatch.candidate.rawPayload,
            })
          : null;

        const sMatchId = row.sMatch?.candidate
          ? await deps.db.createStoreProductMatch({
              canonicalItemId: row.canonicalItem.id,
              storeId: row.sMatch.storeId,
              storeProductId: row.sMatch.storeProductId,
              productName: row.sMatch.candidate.name,
              brand: row.sMatch.candidate.brand ?? null,
              size: row.sMatch.candidate.size ?? null,
              unit: row.sMatch.candidate.unit ?? null,
              price: row.sMatch.candidate.price,
              comparisonPrice: row.sMatch.candidate.comparisonPrice ?? null,
              score: row.sMatch.score,
              confidence: row.sMatch.confidence,
              status: row.sMatch.status === 'mismatch' ? 'ambiguous' : row.sMatch.status,
              rawPayload: row.sMatch.candidate.rawPayload,
            })
          : null;

        await deps.db.addComparisonRunItem({
          comparisonRunId: runId,
          canonicalItemId: row.canonicalItem.id,
          inputItem: row.canonicalItem as unknown as Record<string, unknown>,
          status: row.status,
          rowOrder: index,
          kMatchId,
          sMatchId,
          priceDifference:
            row.kMatch?.candidate && row.sMatch?.candidate
              ? Number((row.kMatch.candidate.price - row.sMatch.candidate.price).toFixed(2))
              : null,
          notes: row.crossStoreValidation?.status === 'mismatch' ? row.crossStoreValidation.reason : null,
        });
      }

      for (const row of rows) {
        for (const log of searchLogs.filter((entry) => entry.query === buildQuery(row.canonicalItem))) {
          await persistSearchLog(deps.db, runId, row.canonicalItem.id, log);
        }
      }

      const run: ComparisonRun = ComparisonRunSchema.parse({
        id: runId,
        selectedKStore: input.selectedKStore,
        selectedSStore: input.selectedSStore,
        inputShoppingList: input.shoppingList,
        matchedRows: rows,
        totals,
        createdAt,
        updatedAt: createdAt,
      });

      return { comparisonRun: run, searchLogs };
    },
  };
}

export type { ProductSearchResult };
