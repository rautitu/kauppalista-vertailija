import { describe, expect, test } from 'bun:test';

import keskoFixture from './fixtures/kesko-search-response.json';
import sGroupFixture from './fixtures/s-group-search-response.json';
import {
  KeskoSearcher,
  SGroupSearcher,
  buildLinuxChromeUserAgent,
  mapKeskoStoreDirectoryPages,
  mapKeskoStoreDirectoryRecord,
  mapKeskoSearchResponse,
  mapSGroupSearchResponse,
  parseChromiumVersion,
  pickTopCandidate,
  scoreCandidateAgainstQuery,
} from './index';

function createJsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('product searchers', () => {
  test('builds a realistic Linux Chrome user agent from Chromium version output', () => {
    expect(parseChromiumVersion('Chromium 148.0.7778.167 snap')).toBe('148.0.7778.167');
    expect(parseChromiumVersion('Google Chrome 148.0.7778.167')).toBe('148.0.7778.167');
    expect(buildLinuxChromeUserAgent('148.0.7778.167')).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36',
    );
  });

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
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        source: 'k-ruoka',
        storeId: 'k-citymarket-lielahti',
        productId: '2000524300000',
        key: '6408430000000',
        ean: '6408430000000',
        name: 'Valio Kevytmaito 1 l',
        brand: 'Valio',
        size: 1,
        unit: 'l',
        price: 1.19,
        comparisonPrice: 1.19,
        searchScore: 40,
        rawPayload: keskoFixture.products[0],
      }),
    );
    expect(result.candidates[0]?.searchScoreBreakdown).toEqual(
      expect.objectContaining({
        normalizedQuery: 'kevytmaito',
        matchedTokens: ['kevytmaito'],
      }),
    );
    expect(result.candidates[1]).toEqual(
      expect.objectContaining({
        source: 'k-ruoka',
        storeId: 'k-citymarket-lielahti',
        productId: '2000524300001',
        key: 'valio|valio kevytmaito laktoositon 1 l',
        ean: null,
        name: 'Valio Kevytmaito laktoositon 1 l',
        brand: 'Valio',
        size: 1,
        unit: 'l',
        price: 1.35,
        comparisonPrice: 1.35,
        searchScore: 40,
        rawPayload: keskoFixture.products[1],
      }),
    );
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
      key: '6408430000142',
      ean: '6408430000142',
      name: 'Valio Luomu kevytmaito 1l',
      brand: 'Valio',
      size: 1,
      unit: 'l',
      price: 1.44,
      comparisonPrice: 1.44,
      searchScore: 0,
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
    expect(String(seenRequests[0]?.init?.body)).toContain('ean');
    expect(result.source).toBe('s-kaupat');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        source: 's-kaupat',
        storeId: '516079340',
        productId: '101010',
        key: '2000000000010',
        ean: '2000000000010',
        name: 'Kotimaista Banaani',
        brand: 'Kotimaista',
        size: 1,
        unit: 'kg',
        price: 1.89,
        comparisonPrice: 1.89,
        searchScore: 40,
        rawPayload: sGroupFixture.results[0],
      }),
    );
    expect(result.candidates[1]).toEqual(
      expect.objectContaining({
        source: 's-kaupat',
        storeId: '516079340',
        productId: '101011',
        key: '2000000000011',
        ean: '2000000000011',
        name: 'Chiquita Banaani 900 g',
        brand: 'Chiquita',
        size: 900,
        unit: 'g',
        price: 2.29,
        comparisonPrice: 2.54,
        searchScore: 40,
        rawPayload: sGroupFixture.results[1],
      }),
    );
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

  test('maps Kesko live store directory records with enriched details', () => {
    const record = mapKeskoStoreDirectoryRecord(
      {
        id: 'N195',
        name: 'K‑Citymarket Helsinki Columbus',
        slug: 'k-citymarket-helsinki-columbus',
        location: 'Helsinki',
        branchCode: 707400,
        chain: 'kcitymarket',
        chainAbbreviation: 'kcm',
        chainName: 'K-Citymarket',
        isWebStore: true,
        geo: {
          latitude: 60.20780092037134,
          longitude: 25.145233716504944,
        },
      },
      {
        id: 'N195',
        name: 'K‑Citymarket Helsinki Columbus',
        location: 'Helsinki',
        details: {
          streetAddress: 'Tyynylaavantie 5',
          postalCode: '00980',
          addressLocality: 'Helsinki',
        },
      },
    );

    expect(record).toEqual({
      source: 'k-ruoka',
      externalId: 'N195',
      storeName: 'K‑Citymarket Helsinki Columbus',
      city: 'Helsinki',
      address: 'Tyynylaavantie 5',
      postalCode: '00980',
      isActive: true,
      metadata: {
        slug: 'k-citymarket-helsinki-columbus',
        chain: 'kcitymarket',
        chainAbbreviation: 'kcm',
        chainName: 'K-Citymarket',
        branchCode: 707400,
        geo: {
          latitude: 60.20780092037134,
          longitude: 25.145233716504944,
        },
        isWebStore: true,
        sourceUrl: 'https://www.k-ruoka.fi/kauppa/k-citymarket-helsinki-columbus',
        source: 'live-browser',
      },
    });
  });

  test('combines paginated Kesko store pages and details by id', () => {
    const records = mapKeskoStoreDirectoryPages(
      [
        {
          totalHits: 3,
          results: [
            { id: 'N1', name: 'K-Supermarket A', slug: 'k-supermarket-a', location: 'Espoo' },
            { id: 'N2', name: 'K-Market B', slug: 'k-market-b', location: 'Vantaa' },
          ],
        },
        {
          totalHits: 3,
          results: [
            { id: 'N2', name: 'K-Market B', slug: 'k-market-b', location: 'Vantaa' },
            { id: 'N3', name: 'K-Market C', slug: 'k-market-c', location: 'Turku' },
          ],
        },
      ],
      {
        N2: {
          id: 'N2',
          details: {
            streetAddress: 'Testikatu 2',
            postalCode: '01300',
            addressLocality: 'Vantaa',
          },
        },
      },
    );

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.externalId)).toEqual(['N1', 'N2', 'N3']);
    expect(records[1]).toEqual(
      expect.objectContaining({
        externalId: 'N2',
        address: 'Testikatu 2',
        postalCode: '01300',
        city: 'Vantaa',
      }),
    );
  });

  test('keeps raw payload debuggable when mapping directly', () => {
    const keskoCandidates = mapKeskoSearchResponse('k-1', keskoFixture);
    const sGroupCandidates = mapSGroupSearchResponse('s-1', sGroupFixture);

    expect(keskoCandidates[0]?.rawPayload).toBe(keskoFixture.products[0]);
    expect(sGroupCandidates[0]?.rawPayload).toBe(sGroupFixture.results[0]);
  });

  test('scores candidates against a free-form query string', () => {
    const scored = scoreCandidateAgainstQuery('Valio kevytmaito 1 l', {
      name: 'Valio kevytmaito 1 l',
      brand: 'Valio',
      size: 1,
      unit: 'l',
    });

    expect(scored.searchScore).toBeGreaterThan(80);
    expect(scored.breakdown).toEqual(
      expect.objectContaining({
        brandMatched: true,
        sizeMatched: true,
        exactNameMatch: true,
      }),
    );
  });

  test('picks one top candidate by highest search score', () => {
    const selected = pickTopCandidate(
      [
        { searchScore: 10, productId: 'a' },
        { searchScore: 80, productId: 'b' },
        { searchScore: 60, productId: 'c' },
      ],
      () => 0,
    );

    expect(selected?.productId).toBe('b');
  });
});
