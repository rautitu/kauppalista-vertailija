export * from './actual.valio.kevyt.maito';

import type { Store, StoreProductCandidate, StoreSource } from '@kauppalista/domain';
import { chromium } from 'playwright-core';
import keskoFallbackStores from './fixtures/kesko-stores.json';

export type ProductSearchRequest = {
  storeId: string;
  query: string;
  limit?: number;
  signal?: AbortSignal;
};

export type ProductSearchResult = {
  source: StoreSource;
  storeId: string;
  query: string;
  candidates: StoreProductCandidate[];
  rawResponse: unknown;
};

export interface ProductSearcher {
  source: StoreSource;
  searchProducts(request: ProductSearchRequest): Promise<ProductSearchResult>;
}

export type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

export type SearcherHttpOptions = {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  userAgent?: string;
};

export type KeskoSearcherOptions = SearcherHttpOptions & {
  searchUrl?: string;
  browserExecutablePath?: string;
  browserUserAgent?: string;
};

export type SGroupSearcherOptions = SearcherHttpOptions & {
  searchUrl?: string;
};

export type StoreDirectoryRecord = {
  source: StoreSource;
  externalId: string;
  storeName: string;
  city?: string | null;
  address?: string | null;
  postalCode?: string | null;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
};

export type StoreDirectoryFetcherOptions = {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  userAgent?: string;
  keskoDirectoryUrl?: string;
  sGroupSitemapUrl?: string;
  sGroupConcurrency?: number;
  sGroupEnrichPages?: boolean;
};

const DEFAULT_S_GROUP_SITEMAP_URL = 'https://www.s-kaupat.fi/sitemap_stores_0.xml';
const DEFAULT_KESKO_SEARCH_URL = 'https://www.k-ruoka.fi/api/search';
const DEFAULT_KESKO_BROWSER_URL = 'https://www.k-ruoka.fi/';
const DEFAULT_S_GROUP_SEARCH_URL = 'https://api.s-kaupat.fi/';
const DEFAULT_USER_AGENT = 'kauppalista-vertailija/phase-5-product-searchers';
const DEFAULT_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const DEFAULT_KESKO_BROWSER_EXECUTABLE_PATH = '/snap/bin/chromium';
const S_GROUP_PRODUCTS_OPERATION_NAME = 'RemoteFilteredProducts';
const S_GROUP_PRODUCTS_QUERY = `query RemoteFilteredProducts($storeId: ID!, $queryString: String, $limit: Int, $from: Int) {
  store(id: $storeId) {
    products(queryString: $queryString, limit: $limit, from: $from) {
      total
      items {
        id
        ean
        name
        price
        comparisonPrice
        comparisonUnit
        brandName
        pricing {
          regularPrice
          campaignPrice
          comparisonUnit
        }
      }
    }
  }
}`;

type KeskoStoreSearchResult = {
  id: string;
  name?: string;
  shortName?: string;
  shortestName?: string;
  slug?: string;
  location?: string;
};

function getFetch(fetchImpl?: FetchLike) {
  return fetchImpl ?? fetch;
}

function normalizeText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSearchValue(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenizeSearchValue(value: string | null | undefined) {
  return normalizeSearchValue(value)
    .split(/\s+/)
    .filter(Boolean);
}

function toSlugTitle(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function dedupeStores(stores: StoreDirectoryRecord[]) {
  const byKey = new Map<string, StoreDirectoryRecord>();

  for (const store of stores) {
    byKey.set(`${store.source}:${store.externalId}`, store);
  }

  return [...byKey.values()].sort((left, right) => {
    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }

    return left.storeName.localeCompare(right.storeName, 'fi');
  });
}

function createHeaders(userAgent = DEFAULT_USER_AGENT) {
  return {
    'user-agent': userAgent,
    accept: 'application/json,text/html,application/xml,text/xml;q=0.9,*/*;q=0.8',
  };
}

function createJsonHeaders(userAgent = DEFAULT_USER_AGENT) {
  return {
    ...createHeaders(userAgent),
    'content-type': 'application/json',
  };
}

async function fetchText(url: string, options: StoreDirectoryFetcherOptions | SearcherHttpOptions = {}) {
  const response = await getFetch(options.fetchImpl)(url, {
    signal: options.signal,
    headers: createHeaders(options.userAgent),
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }

  return response.text();
}

async function fetchJson(url: string, options: SearcherHttpOptions = {}, init: RequestInit = {}) {
  const response = await getFetch(options.fetchImpl)(url, {
    ...init,
    signal: init.signal ?? options.signal,
    headers: {
      ...(createHeaders(options.userAgent) as Record<string, string>),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

function parseSitemapUrls(xml: string) {
  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)];
  return [...new Set(matches.map((match) => match[1]?.trim()).filter(Boolean) as string[])];
}

function extractNextData(html: string) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match?.[1]) {
    throw new Error('Could not find __NEXT_DATA__ payload');
  }

  return JSON.parse(match[1]) as Record<string, unknown>;
}

function readLocalizedText(value: unknown) {
  if (typeof value === 'string') {
    return normalizeText(value);
  }

  if (value && typeof value === 'object' && 'default' in value) {
    return normalizeText((value as { default?: string }).default);
  }

  return null;
}

function readLocalizedRecordField(value: unknown, ...keys: string[]) {
  const record = readObject(value);
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string') {
      const normalized = normalizeText(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function storeRecordFromSGroupUrl(url: string): StoreDirectoryRecord {
  const externalId = url.match(/\/(\d+)(?:\/?$)/)?.[1] ?? url;
  const slug = url.split('/').filter(Boolean).at(-2) ?? externalId;
  const slugParts = slug.split('-').filter(Boolean);
  const city = slugParts.length > 1 ? toSlugTitle(slugParts.at(-1) ?? '') : null;

  return {
    source: 's-kaupat',
    externalId,
    storeName: toSlugTitle(slug),
    city,
    address: null,
    postalCode: null,
    isActive: true,
    metadata: {
      slug,
      sourceUrl: url,
      partial: true,
    },
  };
}

function parseSGroupStorePage(url: string, html: string): StoreDirectoryRecord {
  const nextData = extractNextData(html);
  const pageProps = ((nextData.props as { pageProps?: Record<string, unknown> } | undefined)?.pageProps ?? {}) as Record<
    string,
    unknown
  >;
  const pageStore = (pageProps.store ?? null) as Record<string, unknown> | null;
  const apolloState = (pageProps.apolloState ?? {}) as Record<string, Record<string, unknown>>;

  const fallbackId = url.match(/\/(\d+)(?:\/?$)/)?.[1] ?? '';
  const storeRef = fallbackId ? (apolloState[`Store:{"id":"${fallbackId}"}`] ?? pageStore) : pageStore;
  const store = (storeRef ?? pageStore ?? {}) as Record<string, unknown>;
  const location = (store.location ?? {}) as Record<string, unknown>;
  const address = (location.address ?? {}) as Record<string, unknown>;
  const slug = typeof store.slug === 'string' ? store.slug : url.split('/').filter(Boolean).at(-2) ?? fallbackId;

  return {
    source: 's-kaupat',
    externalId: String(store.id ?? fallbackId),
    storeName: normalizeText(String(store.name ?? toSlugTitle(slug))) ?? toSlugTitle(slug),
    city: readLocalizedText(address.postcodeName),
    address: readLocalizedText(address.street),
    postalCode: normalizeText(typeof address.postcode === 'string' ? address.postcode : null),
    isActive: true,
    metadata: {
      slug,
      brand: normalizeText(typeof store.brand === 'string' ? store.brand : null),
      sourceUrl: url,
    },
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(values.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < values.length) {
      const nextIndex = currentIndex;
      currentIndex += 1;
      results[nextIndex] = await mapper(values[nextIndex]!, nextIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, values.length || 1)) }, () => worker()),
  );

  return results;
}

function mapKeskoFixture(input: Array<Record<string, unknown>>): StoreDirectoryRecord[] {
  return input.map((store) => ({
    source: 'k-ruoka',
    externalId: String(store.externalId ?? store.storeId ?? store.id),
    storeName: String(store.storeName ?? store.name),
    city: normalizeText(typeof store.city === 'string' ? store.city : null),
    address: normalizeText(typeof store.address === 'string' ? store.address : null),
    postalCode: normalizeText(typeof store.postalCode === 'string' ? store.postalCode : null),
    isActive: true,
    metadata: {
      ...(store.metadata && typeof store.metadata === 'object' ? (store.metadata as Record<string, unknown>) : {}),
      source: store.source ?? 'fixture',
    },
  }));
}

function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').trim();
    if (normalized.length === 0) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readObject(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readStringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const normalized = normalizeText(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function readNumberField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function inferSizeAndUnit(record: Record<string, unknown>, name: string) {
  const size = readNumberField(record, 'size', 'packageSize', 'netContent', 'amount', 'volume', 'weight');
  const unit = readStringField(record, 'unit', 'salesUnit', 'measurementUnit', 'packageUnit', 'comparisonUnit');

  if (size !== null || unit) {
    return {
      size,
      unit,
    };
  }

  const nameMatch = name.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ltr|dl|cl|ml|kpl|pkt|ps|rs)/i);
  if (!nameMatch) {
    return {
      size: null,
      unit: null,
    };
  }

  return {
    size: Number(nameMatch[1]!.replace(',', '.')),
    unit: nameMatch[2]!.toLowerCase() === 'ltr' ? 'l' : nameMatch[2]!.toLowerCase(),
  };
}

function readMonetaryValue(value: unknown) {
  if (typeof value === 'number' || typeof value === 'string') {
    return toNumber(value);
  }

  const record = readObject(value);
  if (!record) {
    return null;
  }

  return readNumberField(record, 'value', 'amount', 'price');
}

function readProductPrice(product: Record<string, unknown>) {
  return (
    readNumberField(readObject(readObject(readObject(product.mobilescan)?.pricing)?.discount) ?? {}, 'price') ??
    readNumberField(readObject(readObject(readObject(product.mobilescan)?.pricing)?.batch) ?? {}, 'price') ??
    readNumberField(readObject(readObject(readObject(product.mobilescan)?.pricing)?.normal) ?? {}, 'price') ??
    readMonetaryValue(product.salePrice) ??
    readMonetaryValue(product.currentPrice) ??
    readMonetaryValue(product.price)
  );
}

function readKeskoComparisonPrice(product: Record<string, unknown>) {
  const normalUnitPrice = readObject(readObject(readObject(readObject(product.mobilescan)?.pricing)?.normal)?.unitPrice);

  return readNumberField(normalUnitPrice ?? {}, 'value', 'price') ?? readMonetaryValue(product.comparisonPrice);
}

function createProductFallbackKey(name: string, brand?: string | null) {
  const normalizedName = normalizeSearchValue(name) || name.trim().toLowerCase();
  const normalizedBrand = normalizeSearchValue(brand) || 'unknown';
  return `${normalizedBrand}|${normalizedName}`;
}

function mapKeskoProduct(storeId: string, product: Record<string, unknown>): StoreProductCandidate {
  const sourceProduct = readObject(product.product) ?? product;
  const name =
    readStringField(sourceProduct, 'name', 'productName', 'title') ??
    readLocalizedRecordField(sourceProduct.localizedName, 'finnish', 'fi', 'default', 'english') ??
    readLocalizedRecordField(readObject(sourceProduct.productAttributes)?.marketingName, 'fi', 'finnish', 'default', 'en');

  if (!name) {
    throw new Error('Kesko product is missing name');
  }

  const brand =
    readStringField(sourceProduct, 'brand', 'brandName', 'manufacturer') ??
    readStringField(readObject(sourceProduct.brand) ?? {}, 'name') ??
    readStringField(product, 'brand', 'brandName');
  const ean = readStringField(sourceProduct, 'ean', 'baseEan') ?? readStringField(product, 'ean');
  const productId = readStringField(sourceProduct, 'id', 'productId', 'ean') ?? readStringField(product, 'id') ?? ean ?? name;
  const price = readProductPrice(sourceProduct);
  if (price === null) {
    throw new Error(`Kesko product ${productId} is missing price`);
  }

  const measurements = readObject(readObject(sourceProduct.productAttributes)?.measurements);
  const measurementBackedProduct = {
    ...sourceProduct,
    packageSize: measurements?.contentSize,
    salesUnit: measurements?.contentUnit,
  };
  const { size, unit } = inferSizeAndUnit(measurementBackedProduct, name);

  return {
    source: 'k-ruoka',
    storeId,
    productId,
    key: ean ?? createProductFallbackKey(name, brand),
    ean,
    name,
    brand,
    size,
    unit,
    price,
    comparisonPrice: readKeskoComparisonPrice(sourceProduct),
    rawPayload: product,
  };
}

function mapSGroupProduct(storeId: string, product: Record<string, unknown>): StoreProductCandidate {
  const name = readStringField(product, 'name', 'productName', 'title');
  if (!name) {
    throw new Error('S-group product is missing name');
  }

  const brand = readStringField(product, 'brand', 'brandName', 'manufacturer');
  const ean = readStringField(product, 'ean');
  const productId = readStringField(product, 'id', 'productId', 'ean', 'sku') ?? ean ?? name;
  const pricing = readObject(product.pricing);
  const price = readNumberField(pricing ?? {}, 'campaignPrice', 'regularPrice') ?? readProductPrice(product);
  if (price === null) {
    throw new Error(`S-group product ${productId} is missing price`);
  }

  const measurement = readObject(product.measurement);
  const size = measurement ? readNumberField(measurement, 'value', 'amount') : null;
  const unit = measurement ? readStringField(measurement, 'unit') : null;
  const inferred = size !== null || unit ? { size, unit } : inferSizeAndUnit(product, name);

  return {
    source: 's-kaupat',
    storeId,
    productId,
    key: ean ?? createProductFallbackKey(name, brand),
    ean,
    name,
    brand,
    size: inferred.size,
    unit: inferred.unit,
    price,
    comparisonPrice: readMonetaryValue(product.comparisonPrice) ?? readNumberField(pricing ?? {}, 'regularPrice'),
    rawPayload: product,
  };
}

function ensureArrayResponse(payload: unknown, paths: string[][], source: string) {
  const root = readObject(payload);

  for (const path of paths) {
    let current: unknown = root;

    for (const key of path) {
      current = readObject(current)?.[key];
    }

    if (Array.isArray(current)) {
      return current as Array<Record<string, unknown>>;
    }
  }

  throw new Error(`${source} search response did not contain a product array`);
}

export function mapKeskoSearchResponse(storeId: string, payload: unknown): StoreProductCandidate[] {
  const items = ensureArrayResponse(payload, [['products'], ['items'], ['results'], ['result'], ['data', 'products']], 'Kesko');
  return items.map((item) => mapKeskoProduct(storeId, item));
}

export function mapSGroupSearchResponse(storeId: string, payload: unknown): StoreProductCandidate[] {
  const items = ensureArrayResponse(
    payload,
    [['products'], ['items'], ['results'], ['hits'], ['data', 'products'], ['data', 'store', 'products', 'items']],
    'S-group',
  );
  return items.map((item) => mapSGroupProduct(storeId, item));
}

function isKeskoStoreCode(storeId: string) {
  return /^N\d+$/i.test(storeId);
}

function isSGroupStoreCode(storeId: string) {
  return /^\d+$/.test(storeId);
}

function toKeskoStoreLookupQuery(storeId: string) {
  const fixtureRecord = (keskoFallbackStores as Array<Record<string, unknown>>).find(
    (candidate) => String(candidate.externalId) === storeId,
  );

  if (fixtureRecord) {
    return [fixtureRecord.storeName, fixtureRecord.city].filter(Boolean).join(' ');
  }

  return storeId.replace(/^k-/, '').replace(/-/g, ' ');
}

function scoreKeskoStoreCandidate(storeId: string, candidate: KeskoStoreSearchResult) {
  const searchTokens = tokenizeSearchValue(storeId);
  const candidateTexts = [candidate.slug, candidate.name, candidate.shortName, candidate.shortestName, candidate.location]
    .map((value) => normalizeSearchValue(value))
    .filter(Boolean);

  let score = 0;

  if (candidateTexts.some((value) => value === normalizeSearchValue(storeId))) {
    score += 100;
  }

  for (const token of searchTokens) {
    if (candidateTexts.some((value) => value.includes(token))) {
      score += 10;
    }
  }

  return score;
}

function findBestKeskoStoreMatch(storeId: string, candidates: KeskoStoreSearchResult[]) {
  return [...candidates]
    .map((candidate) => ({ candidate, score: scoreKeskoStoreCandidate(storeId, candidate) }))
    .sort((left, right) => right.score - left.score)[0]?.candidate;
}

async function withKeskoBrowserSession<T>(options: KeskoSearcherOptions, callback: (page: Awaited<ReturnType<typeof chromium.launch>> extends infer TBrowser ? TBrowser extends { newPage: () => Promise<infer TPage> } ? TPage : never : never) => Promise<T>) {
  const executablePath =
    options.browserExecutablePath ?? process.env.KESKO_BROWSER_EXECUTABLE_PATH ?? DEFAULT_KESKO_BROWSER_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = await browser.newPage({
      userAgent: options.browserUserAgent ?? process.env.KESKO_BROWSER_USER_AGENT ?? DEFAULT_BROWSER_USER_AGENT,
    });
    await page.goto(DEFAULT_KESKO_BROWSER_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
    return await callback(page as never);
  } finally {
    await browser.close();
  }
}

async function resolveKeskoStoreId(storeId: string, options: KeskoSearcherOptions) {
  if (isKeskoStoreCode(storeId)) {
    return storeId;
  }

  const query = toKeskoStoreLookupQuery(storeId);

  return withKeskoBrowserSession(options, async (page) => {
    const response = await page.evaluate(async ({ query }) => {
      const result = await fetch('https://www.k-ruoka.fi/kr-api/stores/search', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query, offset: 0, limit: 20 }),
      });

      return {
        status: result.status,
        text: await result.text(),
      };
    }, { query });

    if (response.status !== 200) {
      throw new Error(`Kesko store lookup failed with status ${response.status}`);
    }

    const payload = JSON.parse(response.text) as { results?: KeskoStoreSearchResult[] };
    const candidates = payload.results ?? [];
    const match = findBestKeskoStoreMatch(storeId, candidates);

    if (!match?.id) {
      throw new Error(`Could not resolve Kesko store id for ${storeId}`);
    }

    return match.id;
  });
}

async function searchKeskoProductsWithBrowser(
  storeId: string,
  query: string,
  limit: number | undefined,
  options: KeskoSearcherOptions,
) {
  return withKeskoBrowserSession(options, async (page) => {
    const response = await page.evaluate(async ({ storeId, query, limit }) => {
      const productUrl = new URL(`https://www.k-ruoka.fi/kr-api/v2/product-search/${encodeURIComponent(query)}`);
      productUrl.searchParams.set('storeId', storeId);
      productUrl.searchParams.set('offset', '0');
      productUrl.searchParams.set('limit', String(limit ?? 24));

      async function readResponse(result: Response) {
        return {
          status: result.status,
          headers: Object.fromEntries(Array.from(result.headers)),
          text: await result.text(),
        };
      }

      const baseHeaders = {
        accept: 'application/json',
        origin: 'https://www.k-ruoka.fi',
        referer: `https://www.k-ruoka.fi/haku?q=${encodeURIComponent(query)}`,
      };

      const buildProbe = await readResponse(await fetch(productUrl.toString(), { method: 'POST', headers: baseHeaders }));
      const buildNumber = buildProbe.headers['k-ruoka-build'];

      if (!buildNumber && buildProbe.status !== 200) {
        return buildProbe;
      }

      if (buildProbe.status === 200) {
        return buildProbe;
      }

      return readResponse(
        await fetch(productUrl.toString(), {
          method: 'POST',
          headers: {
            ...baseHeaders,
            'x-k-build-number': buildNumber,
          },
        }),
      );
    }, { storeId, query, limit });

    if (response.status !== 200) {
      throw new Error(`Kesko product search failed with status ${response.status}`);
    }

    return JSON.parse(response.text) as unknown;
  });
}

async function resolveSGroupStoreId(storeId: string, options: SGroupSearcherOptions) {
  if (isSGroupStoreCode(storeId)) {
    return storeId;
  }

  const stores = await getSGroupStores({
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    userAgent: options.userAgent,
    sGroupEnrichPages: false,
  });
  const wanted = normalizeSearchValue(storeId);
  const wantedTokens = tokenizeSearchValue(storeId);

  const match = [...stores]
    .map((store) => {
      const slug = normalizeSearchValue(String(store.metadata?.slug ?? ''));
      const sourceUrl = normalizeSearchValue(String(store.metadata?.sourceUrl ?? ''));
      const storeName = normalizeSearchValue(store.storeName);
      let score = 0;

      if ([slug, sourceUrl, storeName].some((value) => value === wanted)) {
        score += 100;
      }

      for (const token of wantedTokens) {
        if ([slug, sourceUrl, storeName].some((value) => value.includes(token))) {
          score += 10;
        }
      }

      return { store, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.store;

  if (!match) {
    throw new Error(`Could not resolve S-group store id for ${storeId}`);
  }

  return match.externalId;
}

export class KeskoSearcher implements ProductSearcher {
  readonly source = 'k-ruoka' as const;

  constructor(private readonly options: KeskoSearcherOptions = {}) {}

  async searchProducts(request: ProductSearchRequest): Promise<ProductSearchResult> {
    if (!this.options.fetchImpl && !this.options.searchUrl) {
      const resolvedStoreId = await resolveKeskoStoreId(request.storeId, this.options);
      const rawResponse = await searchKeskoProductsWithBrowser(
        resolvedStoreId,
        request.query,
        request.limit,
        this.options,
      );

      return {
        source: this.source,
        storeId: request.storeId,
        query: request.query,
        candidates: mapKeskoSearchResponse(request.storeId, rawResponse),
        rawResponse,
      };
    }

    const baseUrl = this.options.searchUrl ?? process.env.KESKO_PRODUCTS_URL ?? DEFAULT_KESKO_SEARCH_URL;
    const url = new URL(baseUrl);
    url.searchParams.set('storeId', request.storeId);
    url.searchParams.set('q', request.query);
    if (request.limit) {
      url.searchParams.set('limit', String(request.limit));
    }

    const rawResponse = await fetchJson(url.toString(), {
      fetchImpl: this.options.fetchImpl,
      signal: request.signal ?? this.options.signal,
      userAgent: this.options.userAgent,
    });

    return {
      source: this.source,
      storeId: request.storeId,
      query: request.query,
      candidates: mapKeskoSearchResponse(request.storeId, rawResponse),
      rawResponse,
    };
  }
}

export class SGroupSearcher implements ProductSearcher {
  readonly source = 's-kaupat' as const;

  constructor(private readonly options: SGroupSearcherOptions = {}) {}

  async searchProducts(request: ProductSearchRequest): Promise<ProductSearchResult> {
    const resolvedStoreId = await resolveSGroupStoreId(request.storeId, this.options);
    const baseUrl = this.options.searchUrl ?? process.env.S_GROUP_PRODUCTS_URL ?? DEFAULT_S_GROUP_SEARCH_URL;

    const rawResponse = await fetchJson(baseUrl, {
      fetchImpl: this.options.fetchImpl,
      signal: request.signal ?? this.options.signal,
      userAgent: this.options.userAgent,
    }, {
      method: 'POST',
      headers: {
        ...(createJsonHeaders(this.options.userAgent) as Record<string, string>),
        accept: '*/*',
        origin: 'https://www.s-kaupat.fi',
        'x-client-name': 'skaupat-web',
      },
      body: JSON.stringify({
        operationName: S_GROUP_PRODUCTS_OPERATION_NAME,
        variables: {
          storeId: resolvedStoreId,
          queryString: request.query,
          limit: request.limit ?? 24,
          from: 0,
        },
        query: S_GROUP_PRODUCTS_QUERY,
      }),
    });

    return {
      source: this.source,
      storeId: request.storeId,
      query: request.query,
      candidates: mapSGroupSearchResponse(request.storeId, rawResponse),
      rawResponse,
    };
  }
}

async function loadKeskoStoresFromUrl(url: string, options: StoreDirectoryFetcherOptions) {
  const payload = await fetchText(url, options);
  const parsed = JSON.parse(payload) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Kesko directory payload must be a JSON array');
  }

  return mapKeskoFixture(parsed as Array<Record<string, unknown>>);
}

export async function getKeskoStores(options: StoreDirectoryFetcherOptions = {}) {
  const keskoDirectoryUrl = options.keskoDirectoryUrl ?? process.env.KESKO_STORES_URL;

  if (keskoDirectoryUrl) {
    try {
      return dedupeStores(await loadKeskoStoresFromUrl(keskoDirectoryUrl, options));
    } catch (error) {
      console.warn('Falling back to bundled Kesko stores fixture', error);
    }
  }

  return dedupeStores(mapKeskoFixture(keskoFallbackStores as Array<Record<string, unknown>>));
}

export async function getSGroupStores(options: StoreDirectoryFetcherOptions = {}) {
  const sitemapUrl = options.sGroupSitemapUrl ?? process.env.S_GROUP_STORES_SITEMAP_URL ?? DEFAULT_S_GROUP_SITEMAP_URL;
  const sitemapXml = await fetchText(sitemapUrl, options);
  const urls = parseSitemapUrls(sitemapXml);
  const shouldEnrichPages = options.sGroupEnrichPages ?? (process.env.S_GROUP_ENRICH_STORE_PAGES === 'true');

  if (!shouldEnrichPages) {
    return dedupeStores(urls.map((url) => storeRecordFromSGroupUrl(url)));
  }

  const concurrency = Math.max(1, Math.min(options.sGroupConcurrency ?? 8, 16));
  const stores = await mapWithConcurrency(urls, concurrency, async (url) => {
    try {
      const html = await fetchText(url, options);
      return parseSGroupStorePage(url, html);
    } catch (error) {
      console.warn(`Failed to fully parse S-group store page ${url}`, error);
      return storeRecordFromSGroupUrl(url);
    }
  });

  return dedupeStores(stores);
}

export function toDomainStore(record: StoreDirectoryRecord): Store {
  return {
    source: record.source,
    storeId: record.externalId,
    storeName: record.storeName,
    city: record.city ?? null,
    address: record.address ?? null,
  };
}
