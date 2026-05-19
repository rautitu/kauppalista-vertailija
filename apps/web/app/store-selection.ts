import type { StoreSource } from "@kauppalista/domain";

export type StoreOption = {
  id?: string;
  source: StoreSource;
  storeId: string;
  externalId: string;
  storeName: string;
  city: string | null;
  address: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeSavedStoreOption(value: unknown, source: StoreSource): StoreOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const storeId = typeof value.storeId === "string" ? value.storeId.trim() : "";
  const externalIdValue = typeof value.externalId === "string" ? value.externalId.trim() : "";
  const storeName = typeof value.storeName === "string" ? value.storeName.trim() : "";
  if (!storeId || !storeName) {
    return null;
  }

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined,
    source,
    storeId,
    externalId: externalIdValue || storeId,
    storeName,
    city: typeof value.city === "string" && value.city.trim() ? value.city.trim() : null,
    address: typeof value.address === "string" && value.address.trim() ? value.address.trim() : null,
  };
}

export function getStoreRehydrationQuery(store: StoreOption) {
  return store.externalId || store.storeId || store.storeName;
}

export function resolveSelectedStoreOption(selected: StoreOption, stores: StoreOption[]): StoreOption | null {
  return (
    stores.find((store) => store.storeId === selected.storeId) ??
    stores.find((store) => store.externalId === selected.externalId) ??
    stores.find(
      (store) =>
        store.storeName === selected.storeName &&
        store.city === selected.city &&
        store.address === selected.address,
    ) ??
    null
  );
}

export function mergeStoreOptions(stores: StoreOption[], store: StoreOption) {
  const withoutMatch = stores.filter(
    (candidate) => candidate.storeId !== store.storeId && candidate.externalId !== store.externalId,
  );
  return [store, ...withoutMatch];
}
