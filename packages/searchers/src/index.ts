import type { Store, StoreSource } from '@kauppalista/domain';
import keskoFallbackStores from './fixtures/kesko-stores.json';

export interface ProductSearcher {
  source: 'k-ruoka' | 's-kaupat';
}

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
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  keskoDirectoryUrl?: string;
  sGroupSitemapUrl?: string;
  sGroupConcurrency?: number;
  sGroupEnrichPages?: boolean;
};

const DEFAULT_S_GROUP_SITEMAP_URL = 'https://www.s-kaupat.fi/sitemap_stores_0.xml';

function getFetch(fetchImpl?: typeof fetch) {
  return fetchImpl ?? fetch;
}

function normalizeText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
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

async function fetchText(url: string, options: StoreDirectoryFetcherOptions = {}) {
  const response = await getFetch(options.fetchImpl)(url, {
    signal: options.signal,
    headers: {
      'user-agent': 'kauppalista-vertailija/phase-4-store-directory',
      accept: 'text/html,application/xml,text/xml,application/json;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }

  return response.text();
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
