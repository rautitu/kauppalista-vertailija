import { createDatabase } from '@kauppalista/db';
import { getKeskoStores, getSGroupStores } from '@kauppalista/searchers';

const db = createDatabase();

export async function syncStoreDirectory() {
  console.info('[sync:stores] Starting store directory sync');
  const [keskoStores, sGroupStores] = await Promise.all([getKeskoStores(), getSGroupStores()]);
  console.info(`[sync:stores] Loaded store directories kesko=${keskoStores.length} sGroup=${sGroupStores.length}`);

  const keskoResult = await db.syncStores(
    'k-ruoka',
    keskoStores.map((store) => ({
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
  console.info(`[sync:stores] Wrote stores to database source=k-ruoka synced=${keskoResult.synced}`);

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
    kesko: keskoResult.synced,
    sGroup: sGroupResult.synced,
  };
}

async function main() {
  const command = Bun.argv[2] ?? 'worker';

  if (command === 'sync-stores') {
    const result = await syncStoreDirectory();
    console.log(`Synced stores: Kesko ${result.kesko}, S-group ${result.sGroup}`);
    await db.close();
    return;
  }

  console.log('Worker ready. Run `bun src/index.ts sync-stores` to refresh stores.');
  await new Promise(() => {});
}

await main();
