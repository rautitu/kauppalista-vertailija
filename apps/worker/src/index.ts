import { createDatabase } from '@kauppalista/db';
import { getKeskoStoresLive, getSGroupStores } from '@kauppalista/searchers';

const db = createDatabase();

export async function syncStoreDirectory() {
  console.info('[sync:stores] Starting store directory sync');
  const [keskoResult, sGroupStores] = await Promise.all([
    getKeskoStoresLive()
      .then((stores) => ({ stores }))
      .catch((error) => {
        console.warn('[sync:stores] Kesko live sync failed, preserving existing database stores', error);
        return { stores: null };
      }),
    getSGroupStores(),
  ]);
  console.info(
    `[sync:stores] Loaded store directories kesko=${keskoResult.stores?.length ?? 'preserved-existing'} sGroup=${sGroupStores.length}`,
  );

  let keskoSynced: number | null = null;
  if (keskoResult.stores) {
    const synced = await db.syncStores(
      'k-ruoka',
      keskoResult.stores.map((store) => ({
        source: store.source,
        externalId: store.externalId,
        name: store.storeName,
        city: store.city ?? null,
        address: store.address ?? null,
        postalCode: store.postalCode ?? null,
        isActive: store.isActive ?? true,
        metadata: store.metadata ?? {},
      })),
    );
    keskoSynced = synced.synced;
    console.info(`[sync:stores] Wrote stores to database source=k-ruoka synced=${synced.synced}`);
  } else {
    console.warn('[sync:stores] Skipped database write for source=k-ruoka and preserved existing rows');
  }

  const sGroupResult = await db.syncStores(
    's-kaupat',
    sGroupStores.map((store) => ({
      source: store.source,
      externalId: store.externalId,
      name: store.storeName,
      city: store.city ?? null,
      address: store.address ?? null,
      postalCode: store.postalCode ?? null,
      isActive: store.isActive ?? true,
      metadata: store.metadata ?? {},
    })),
  );
  console.info(`[sync:stores] Wrote stores to database source=s-kaupat synced=${sGroupResult.synced}`);

  return {
    kesko: keskoSynced,
    sGroup: sGroupResult.synced,
  };
}

async function main() {
  const command = Bun.argv[2] ?? 'worker';

  if (command === 'sync-stores') {
    const result = await syncStoreDirectory();
    console.log(`Synced stores: Kesko ${result.kesko === null ? 'preserved-existing' : result.kesko}, S-group ${result.sGroup}`);
    await db.close();
    return;
  }

  console.log('Worker ready. Run `bun src/index.ts sync-stores` to refresh stores.');
  await new Promise(() => {});
}

await main();
