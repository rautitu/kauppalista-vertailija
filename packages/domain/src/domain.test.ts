import { describe, expect, test } from 'bun:test';

import {
  CanonicalItemSchema,
  ComparisonRunSchema,
  ProductMatchSchema,
  StoreProductCandidateSchema,
  StoreSchema,
} from './index';

describe('domain schemas', () => {
  test('parses a valid canonical item and applies array defaults', () => {
    const item = CanonicalItemSchema.parse({
      id: 'item-milk-1l',
      name: 'Kevytmaito',
      brand: 'Valio',
      size: 1,
      unit: 'l',
      category: 'milk',
    });

    expect(item.synonyms).toEqual([]);
    expect(item.aliases).toEqual([]);
  });

  test('rejects invalid store source', () => {
    const result = StoreSchema.safeParse({
      source: 'lidl',
      storeId: '123',
      storeName: 'Testi',
    });

    expect(result.success).toBe(false);
  });

  test('rejects negative candidate price', () => {
    const result = StoreProductCandidateSchema.safeParse({
      source: 'k-ruoka',
      storeId: 'k-123',
      productId: 'prod-1',
      key: 'banana|banaani',
      ean: null,
      name: 'Banaani',
      price: -1,
      rawPayload: {},
    });

    expect(result.success).toBe(false);
  });

  test('rejects product match confidence outside 0..1', () => {
    const result = ProductMatchSchema.safeParse({
      canonicalItemId: 'item-1',
      source: 's-kaupat',
      storeId: 's-123',
      storeProductId: 'prod-1',
      score: 88,
      confidence: 1.2,
      status: 'matched',
    });

    expect(result.success).toBe(false);
  });

  test('parses a valid comparison run', () => {
    const run = ComparisonRunSchema.parse({
      id: 'run-1',
      selectedKStore: {
        source: 'k-ruoka',
        storeId: 'k-1',
        storeName: 'K-Citymarket Lielahti',
        city: 'Tampere',
      },
      selectedSStore: {
        source: 's-kaupat',
        storeId: 's-1',
        storeName: 'Prisma Koivistonkylä',
        city: 'Tampere',
      },
      inputShoppingList: [
        {
          id: 'item-banana',
          name: 'Banaani',
          size: 1,
          unit: 'kg',
        },
      ],
      matchedRows: [
        {
          canonicalItem: {
            id: 'item-banana',
            name: 'Banaani',
            size: 1,
            unit: 'kg',
          },
          kMatch: {
            canonicalItemId: 'item-banana',
            source: 'k-ruoka',
            storeId: 'k-1',
            storeProductId: 'k-prod-1',
            score: 100,
            confidence: 0.98,
            status: 'matched',
          },
          sMatch: {
            canonicalItemId: 'item-banana',
            source: 's-kaupat',
            storeId: 's-1',
            storeProductId: 's-prod-1',
            score: 96,
            confidence: 0.93,
            status: 'matched',
          },
          status: 'matched',
        },
      ],
      totals: {
        kTotal: 2.59,
        sTotal: 2.49,
        difference: 0.1,
        matchedItems: 1,
        ambiguousItems: 0,
        missingItems: 0,
      },
      createdAt: '2026-04-27T09:00:00.000Z',
      updatedAt: '2026-04-27T09:00:05.000Z',
    });

    expect(run.createdAt).toBeInstanceOf(Date);
    expect(run.selectedKStore.source).toBe('k-ruoka');
    expect(run.selectedSStore.source).toBe('s-kaupat');
  });

  test('rejects mismatched selected store sources in comparison run', () => {
    const result = ComparisonRunSchema.safeParse({
      id: 'run-2',
      selectedKStore: {
        source: 's-kaupat',
        storeId: 'wrong',
        storeName: 'Wrong store',
      },
      selectedSStore: {
        source: 's-kaupat',
        storeId: 's-1',
        storeName: 'Prisma',
      },
      inputShoppingList: [],
      matchedRows: [],
      totals: {
        kTotal: 0,
        sTotal: 0,
        difference: 0,
        matchedItems: 0,
        ambiguousItems: 0,
        missingItems: 0,
      },
      createdAt: '2026-04-27T09:00:00.000Z',
      updatedAt: '2026-04-27T09:00:05.000Z',
    });

    expect(result.success).toBe(false);
  });
});
