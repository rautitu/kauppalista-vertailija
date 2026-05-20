import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSavedStoreOption,
  resolveSelectedStoreOption,
} from "./store-selection";

test("normalizes saved stores and falls back externalId to storeId for legacy entries", () => {
  assert.deepEqual(
    normalizeSavedStoreOption(
      {
        storeId: "legacy-k-store-code",
        storeName: "K-Citymarket Lielahti",
        city: "Tampere",
      },
      "k-ruoka",
    ),
    {
      id: undefined,
      source: "k-ruoka",
      storeId: "legacy-k-store-code",
      externalId: "legacy-k-store-code",
      storeName: "K-Citymarket Lielahti",
      city: "Tampere",
      address: null,
    },
  );
});

test("resolves a persisted selection to the fresh store record by external id", () => {
  const selected = {
    source: "s-kaupat" as const,
    storeId: "stale-internal-id",
    externalId: "516079340",
    storeName: "Prisma Koivistonkylä",
    city: "Tampere",
    address: "Koivistontie 1",
  };

  assert.deepEqual(
    resolveSelectedStoreOption(selected, [
      {
        id: "db-id-123",
        source: "s-kaupat",
        storeId: "fresh-internal-id",
        externalId: "516079340",
        storeName: "Prisma Koivistonkylä",
        city: "Tampere",
        address: "Koivistontie 1",
      },
    ]),
    {
      id: "db-id-123",
      source: "s-kaupat",
      storeId: "fresh-internal-id",
      externalId: "516079340",
      storeName: "Prisma Koivistonkylä",
      city: "Tampere",
      address: "Koivistontie 1",
    },
  );
});
