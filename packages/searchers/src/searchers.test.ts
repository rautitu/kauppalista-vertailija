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

  test('maps real Kesko v2 responses into store product candidates', () => {
    const [candidate] = mapKeskoSearchResponse('k-citymarket-lielahti', {
      result: [
        {
          id: '6408430000142',
          product: {
            id: '6408430000142',
            ean: '6408430000142',
            localizedName: {
              finnish: 'Valio Luomu kevytmaito 1l',
            },
            brand: {
              name: 'Valio',
            },
            productAttributes: {
              measurements: {
                contentSize: 1,
                contentUnit: 'l',
              },
            },
            mobilescan: {
              pricing: {
                normal: {
                  price: 1.44,
                  unitPrice: {
                    value: 1.44,
                    unit: 'l',
                  },
                },
              },
            },
          },
        },
      ],
    });

    expect(candidate).toEqual({
      source: 'k-ruoka',
      storeId: 'k-citymarket-lielahti',
      productId: '6408430000142',
      name: 'Valio Luomu kevytmaito 1l',
      brand: 'Valio',
      size: 1,
      unit: 'l',
      price: 1.44,
      comparisonPrice: 1.44,
      rawPayload: {
        id: '6408430000142',
        product: {
          id: '6408430000142',
          ean: '6408430000142',
          localizedName: {
            finnish: 'Valio Luomu kevytmaito 1l',
          },
          brand: {
            name: 'Valio',
          },
          productAttributes: {
            measurements: {
              contentSize: 1,
              contentUnit: 'l',
            },
          },
          mobilescan: {
            pricing: {
              normal: {
                price: 1.44,
                unitPrice: {
                  value: 1.44,
                  unit: 'l',
                },
              },
            },
          },
        },
      },
    });
  });

  test('maps S-group GraphQL responses into store product candidates', async () => {
    const seenRequests: Array<{ url: string; init?: RequestInit }> = [];
    const searcher = new SGroupSearcher({
      searchUrl: 'https://example.test/s-group-search',
      fetchImpl: async (input, init) => {
        seenRequests.push({ url: String(input), init });
        return createJsonResponse({
          data: {
            store: {
              products: {
                total: sGroupFixture.results.length,
                items: sGroupFixture.results,
              },
            },
          },
        });
      },
    });

    const result = await searcher.searchProducts({
      storeId: '516079340',
      query: 'banaani',
    });

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]?.url).toBe('https://example.test/s-group-search');
    expect(seenRequests[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(seenRequests[0]?.init?.body))).toMatchObject({
      operationName: 'RemoteFilteredProducts',
      variables: {
        storeId: '516079340',
        queryString: 'banaani',
        limit: 24,
        from: 0,
      },
    });
    expect(result.source).toBe('s-kaupat');
    expect(result.candidates).toEqual([
      {
        source: 's-kaupat',
        storeId: '516079340',
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
        storeId: '516079340',
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
