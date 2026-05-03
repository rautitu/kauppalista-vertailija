import { describe, expect, test } from 'bun:test';

import type { CanonicalItem, StoreProductCandidate } from '../../domain/src/index';
import {
  createPackageSizeFromParts,
  createStoreProductFallbackKey,
  createStoreProductKey,
  findBestCandidateMatch,
  normalizeCanonicalItem,
  normalizeName,
  normalizeStoreProductCandidate,
  normalizeText,
  normalizeUnit,
  parsePackageSize,
  tokenizeText,
} from './index';

describe('matcher normalization', () => {
  test('normalizes text casing, whitespace, and common unit aliases', () => {
    expect(normalizeText('  VALIO   Kevytmaito  1 LTR  ')).toBe('valio kevytmaito 1 l');
    expect(tokenizeText('2 x 200 g kanafilee')).toEqual(['2', '200', 'kanafilee']);
  });

  test.each([
    ['g', 'g'],
    ['gr', 'g'],
    ['kilo', 'kg'],
    ['ltr', 'l'],
    ['desilitra', 'dl'],
    ['kappale', 'kpl'],
    ['pieces', 'kpl'],
  ] as const)('normalizes unit %s -> %s', (input, expected) => {
    expect(normalizeUnit(input)).toBe(expected);
  });

  test.each([
    ['Valio kevytmaito 1 l', { packageCount: 1, quantity: 1, unit: 'l', standardizedUnit: 'ml', standardizedTotalQuantity: 1000 }],
    ['Valio kevytmaito 1,5l', { packageCount: 1, quantity: 1.5, unit: 'l', standardizedUnit: 'ml', standardizedTotalQuantity: 1500 }],
    ['Chiquita Banaani 900 g', { packageCount: 1, quantity: 900, unit: 'g', standardizedUnit: 'g', standardizedTotalQuantity: 900 }],
    ['Atria 2x200g jauheliha', { packageCount: 2, quantity: 200, unit: 'g', standardizedUnit: 'g', standardizedTotalQuantity: 400 }],
    ['Kananmuna 10 kpl', { packageCount: 1, quantity: 10, unit: 'kpl', standardizedUnit: 'kpl', standardizedTotalQuantity: 10 }],
    ['Pepsi Max 6 × 330 ml', { packageCount: 6, quantity: 330, unit: 'ml', standardizedUnit: 'ml', standardizedTotalQuantity: 1980 }],
  ] as const)('parses package size from %s', (input, expected) => {
    expect(parsePackageSize(input)).toMatchObject(expected);
  });

  test('creates package size from explicit numeric parts', () => {
    expect(createPackageSizeFromParts(1, 'l')).toMatchObject({
      quantity: 1,
      unit: 'l',
      standardizedUnit: 'ml',
      standardizedTotalQuantity: 1000,
    });
  });

  test('normalizes names for matcher use', () => {
    const normalized = normalizeName('  Valio   Kevytmaito  1l ', 'Valio');

    expect(normalized.brand).toBe('valio');
    expect(normalized.parsedSize).toMatchObject({
      quantity: 1,
      unit: 'l',
      standardizedTotalQuantity: 1000,
    });
    expect(normalized.comparisonText).toBe('kevytmaito');
    expect(normalized.tokens).toEqual(['kevytmaito']);
    expect(normalized.fingerprint).toBe('kevytmaito');
  });

  test('infers brand conservatively from leading token when brand is missing', () => {
    const normalized = normalizeName('Pirkka banaani 1 kg');

    expect(normalized.brand).toBe('pirkka');
    expect(normalized.brandSource).toBe('inferred');
    expect(normalized.tokens).toEqual(['banaani']);
  });

  test('normalizes canonical items including synonyms and aliases', () => {
    const item: CanonicalItem = {
      id: 'milk-1',
      name: 'Valio Kevytmaito 1 l',
      brand: 'Valio',
      manufacturer: null,
      size: 1,
      unit: 'ltr',
      category: null,
      synonyms: ['kevyt maito 1l'],
      aliases: ['  VALIO kevytmaito 1 L  '],
    };

    const normalized = normalizeCanonicalItem(item);

    expect(normalized.brand).toBe('valio');
    expect(normalized.parsedSize).toMatchObject({
      quantity: 1,
      unit: 'l',
      standardizedTotalQuantity: 1000,
    });
    expect(normalized.names.map((entry) => entry.fingerprint)).toEqual([
      'kevytmaito',
      'kevyt maito',
      'kevytmaito',
    ]);
  });

  test('normalizes store product candidates with explicit brand and size fields', () => {
    const candidate: StoreProductCandidate = {
      source: 's-kaupat',
      storeId: '123',
      productId: 'sku-1',
      key: 'kotimaista|kotimaista banaani 900 g',
      ean: null,
      name: 'Kotimaista Banaani 900 g',
      brand: 'Kotimaista',
      size: 900,
      unit: 'gr',
      price: 1.99,
      comparisonPrice: 2.21,
      rawPayload: {},
    };

    const normalized = normalizeStoreProductCandidate(candidate);

    expect(normalized.brand).toBe('kotimaista');
    expect(normalized.parsedSize).toMatchObject({
      quantity: 900,
      unit: 'g',
      standardizedTotalQuantity: 900,
    });
    expect(normalized.name.tokens).toEqual(['banaani']);
  });

  test('prefers ean as product key and falls back to normalized brand + name', () => {
    const withEan: StoreProductCandidate = {
      source: 'k-ruoka',
      storeId: 'k-1',
      productId: 'prod-1',
      key: '6408430000456',
      ean: '6408430000456',
      name: 'Valio kevytmaito 5 dl',
      brand: 'Valio',
      size: 5,
      unit: 'dl',
      price: 1.05,
      rawPayload: {},
    };

    const withoutEan: StoreProductCandidate = {
      source: 's-kaupat',
      storeId: 's-1',
      productId: 'prod-2',
      key: 'legacy-value',
      ean: null,
      name: 'Valio kevytmaito 5 dl',
      brand: 'Valio',
      size: 5,
      unit: 'dl',
      price: 1.09,
      rawPayload: {},
    };

    expect(createStoreProductKey(withEan)).toBe('6408430000456');
    expect(createStoreProductFallbackKey(withoutEan)).toBe('valio|valio kevytmaito 5 dl');
    expect(createStoreProductKey(withoutEan)).toBe('legacy-value');
  });

  test('finds best match by ean before falling back to brand + name', () => {
    const leftCandidates: StoreProductCandidate[] = [
      {
        source: 'k-ruoka',
        storeId: 'k-1',
        productId: 'left-1',
        key: '6408430000456',
        ean: '6408430000456',
        name: 'Valio kevytmaito 5 dl',
        brand: 'Valio',
        size: 5,
        unit: 'dl',
        price: 1.05,
        rawPayload: {},
      },
      {
        source: 'k-ruoka',
        storeId: 'k-1',
        productId: 'left-2',
        key: 'valio|valio kevytmaito 1 l',
        ean: null,
        name: 'Valio kevytmaito 1 l',
        brand: 'Valio',
        size: 1,
        unit: 'l',
        price: 1.59,
        rawPayload: {},
      },
    ];

    const rightCandidates: StoreProductCandidate[] = [
      {
        source: 's-kaupat',
        storeId: 's-1',
        productId: 'right-1',
        key: 'valio|valio kevytmaito 1 l',
        ean: null,
        name: 'Valio kevytmaito 1 l',
        brand: 'Valio',
        size: 1,
        unit: 'l',
        price: 1.55,
        rawPayload: {},
      },
      {
        source: 's-kaupat',
        storeId: 's-1',
        productId: 'right-2',
        key: '6408430000456',
        ean: '6408430000456',
        name: 'Valio kevytmaito 5 dl',
        brand: 'Valio',
        size: 5,
        unit: 'dl',
        price: 1.09,
        rawPayload: {},
      },
    ];

    const match = findBestCandidateMatch(leftCandidates, rightCandidates);

    expect(match).not.toBeNull();
    expect(match?.reason).toBe('ean');
    expect(match?.left.productId).toBe('left-1');
    expect(match?.right.productId).toBe('right-2');
  });
});
