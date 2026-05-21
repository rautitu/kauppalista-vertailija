import { createDatabase } from '@kauppalista/db';
import { writeStructuredLog } from '@kauppalista/domain';
import { getKeskoStoresLive, getSGroupStores } from '@kauppalista/searchers';

const db = createDatabase();

function waitForShutdownSignal() {
  return new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {}, 60 * 60 * 1000);
    const shutdown = () => {
      clearInterval(keepAlive);
      resolve();
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

export async function syncStoreDirectory() {
  writeStructuredLog('info', 'worker.store_sync.started', {
    phase: 'store_sync',
  });
  const [keskoResult, sGroupStores] = await Promise.all([
    getKeskoStoresLive()
      .then((stores) => ({ stores }))
      .catch((error) => {
        writeStructuredLog('warn', 'worker.store_sync.kesko_failed_preserving_existing', {
          phase: 'store_sync',
          source: 'k-ruoka',
          error,
        });
        return { stores: null };
      }),
    getSGroupStores(),
  ]);
  writeStructuredLog('info', 'worker.store_sync.directories_loaded', {
    phase: 'store_sync',
    counts: {
      kesko: keskoResult.stores?.length ?? null,
      sGroup: sGroupStores.length,
    },
    preservedExisting: {
      kesko: keskoResult.stores === null,
    },
  });

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
    writeStructuredLog('info', 'worker.store_sync.db_written', {
      phase: 'store_sync',
      source: 'k-ruoka',
      synced: synced.synced,
    });
  } else {
    writeStructuredLog('warn', 'worker.store_sync.db_write_skipped', {
      phase: 'store_sync',
      source: 'k-ruoka',
      reason: 'preserving_existing_rows',
    });
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
  writeStructuredLog('info', 'worker.store_sync.db_written', {
    phase: 'store_sync',
    source: 's-kaupat',
    synced: sGroupResult.synced,
  });

  return {
    kesko: keskoSynced,
    sGroup: sGroupResult.synced,
  };
}

async function main() {
  const command = Bun.argv[2] ?? 'worker';

  if (command === 'sync-stores') {
    const result = await syncStoreDirectory();
    writeStructuredLog('info', 'worker.store_sync.completed', {
      phase: 'store_sync',
      result,
    });
    await db.close();
    return;
  }

  writeStructuredLog('info', 'worker.ready', {
    phase: 'worker',
    commandHint: 'bun src/index.ts sync-stores',
  });
  await waitForShutdownSignal();
  await db.close();
}

await main();
