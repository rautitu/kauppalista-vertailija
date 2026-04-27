import { createDatabase } from '@kauppalista/db';
import { getKeskoStores, getSGroupStores } from '@kauppalista/searchers';

const db = createDatabase();

export async function syncStoreDirectory() {
  const [keskoStores, sGroupStores] = await Promise.all([getKeskoStores(), getSGroupStores()]);

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
