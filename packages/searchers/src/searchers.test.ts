import { describe, expect, test } from 'bun:test';

import keskoFixture from './fixtures/kesko-search-response.json';
import sGroupFixture from './fixtures/s-group-search-response.json';
import { KeskoSearcher, SGroupSearcher, mapKeskoSearchResponse, mapSGroupSearchResponse } from './index';

function createJsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('product searchers', () => {
  test('maps Kesko search responses into store product candidates', async () => {
    const seenUrls: string[] = [];
    const searcher = new KeskoSearcher({
      searchUrl: 'https://example.test/kesko-search',
      fetchImpl: async (input) => {
        seenUrls.push(String(input));
        return createJsonResponse(keskoFixture);
      },
    });

    const result = await searcher.searchProducts({
      storeId: 'k-citymarket-lielahti',
      query: 'kevytmaito',
      limit: 5,
    });

    expect(seenUrls).toHaveLength(1);
    expect(seenUrls[0]).toContain('storeId=k-citymarket-lielahti');
    expect(seenUrls[0]).toContain('q=kevytmaito');
    expect(seenUrls[0]).toContain('limit=5');
    expect(result.source).toBe('k-ruoka');
    expect(result.rawResponse).toEqual(keskoFixture);
    expect(result.candidates).toEqual([
      {
        source: 'k-ruoka',
        storeId: 'k-citymarket-lielahti',
        productId: '2000524300000',
        name: 'Valio Kevytmaito 1 l',
        brand: 'Valio',
        size: 1,
        unit: 'l',
        price: 1.19,
        comparisonPrice: 1.19,
        rawPayload: keskoFixture.products[0],
      },
      {
        source: 'k-ruoka',
        storeId: 'k-citymarket-lielahti',
        productId: '2000524300001',
        name: 'Valio Kevytmaito laktoositon 1 l',
        brand: 'Valio',
        size: 1,
        unit: 'l',
        price: 1.35,
        comparisonPrice: 1.35,
        rawPayload: keskoFixture.products[1],
      },
    ]);
  });

  test('maps S-group search responses into store product candidates', async () => {
    const seenUrls: string[] = [];
    const searcher = new SGroupSearcher({
      searchUrl: 'https://example.test/s-group-search',
      fetchImpl: async (input) => {
        seenUrls.push(String(input));
        return createJsonResponse(sGroupFixture);
      },
    });

    const result = await searcher.searchProducts({
      storeId: 'prisma-koivistonkylä',
      query: 'banaani',
    });

    expect(seenUrls).toHaveLength(1);
    expect(seenUrls[0]).toContain('storeId=prisma-koivistonkyl%C3%A4');
    expect(seenUrls[0]).toContain('q=banaani');
    expect(result.source).toBe('s-kaupat');
    expect(result.rawResponse).toEqual(sGroupFixture);
    expect(result.candidates).toEqual([
      {
        source: 's-kaupat',
        storeId: 'prisma-koivistonkylä',
        productId: '101010',
        name: 'Kotimaista Banaani',
        brand: 'Kotimaista',
        size: 1,
        unit: 'kg',
        price: 1.89,
        comparisonPrice: 1.89,
        rawPayload: sGroupFixture.results[0],
      },
      {
        source: 's-kaupat',
        storeId: 'prisma-koivistonkylä',
        productId: '101011',
        name: 'Chiquita Banaani 900 g',
        brand: 'Chiquita',
        size: 900,
        unit: 'g',
        price: 2.29,
        comparisonPrice: 2.54,
        rawPayload: sGroupFixture.results[1],
      },
    ]);
  });

  test('prefers salePrice over currentPrice and price when present', () => {
    const [candidate] = mapKeskoSearchResponse('k-1', {
      products: [
        {
          id: 'promo-1',
          name: 'Tarjoustuote 1 kpl',
          price: 5.99,
          currentPrice: 4.99,
          salePrice: {
            value: 3.99,
          },
        },
      ],
    });

    expect(candidate?.price).toBe(3.99);
  });

  test('falls back from malformed price object to salePrice/currentPrice', () => {
    const [candidate] = mapKeskoSearchResponse('k-1', {
      products: [
        {
          id: 'promo-2',
          name: 'Erikoinen hinta 1 kpl',
          price: {
            currency: 'EUR',
          },
          salePrice: '2.49',
          currentPrice: 2.99,
        },
      ],
    });

    expect(candidate?.price).toBe(2.49);
  });

  test('keeps raw payload debuggable when mapping directly', () => {
    const keskoCandidates = mapKeskoSearchResponse('k-1', keskoFixture);
    const sGroupCandidates = mapSGroupSearchResponse('s-1', sGroupFixture);

    expect(keskoCandidates[0]?.rawPayload).toBe(keskoFixture.products[0]);
    expect(sGroupCandidates[0]?.rawPayload).toBe(sGroupFixture.results[0]);
  });
});
