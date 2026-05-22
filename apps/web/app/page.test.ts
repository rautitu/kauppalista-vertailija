import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSavedStoreOption,
  resolveSelectedStoreOption,
} from "./store-selection";
import {
  ITEM_PROGRESS_END_PERCENT,
  ITEM_PROGRESS_START_PERCENT,
  calculateItemProgressPercent,
} from "./comparison-progress";

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

test("calculates item progress across the reserved 10-50 percent range", () => {
  assert.equal(calculateItemProgressPercent(0, 4), ITEM_PROGRESS_START_PERCENT);
  assert.equal(calculateItemProgressPercent(1, 4), 20);
  assert.equal(calculateItemProgressPercent(2, 4), 30);
  assert.equal(calculateItemProgressPercent(3, 4), 40);
  assert.equal(calculateItemProgressPercent(4, 4), ITEM_PROGRESS_END_PERCENT);
});

test("rounds item progress to whole percentages based on item count", () => {
  assert.equal(calculateItemProgressPercent(1, 3), 23);
  assert.equal(calculateItemProgressPercent(2, 3), 37);
  assert.equal(calculateItemProgressPercent(3, 3), ITEM_PROGRESS_END_PERCENT);
});
