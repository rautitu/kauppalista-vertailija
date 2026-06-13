import type { ComparisonRunItem, ComparisonRunTotals } from "@kauppalista/domain";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getItemQuantity(row: ComparisonRunItem) {
  const quantity = row.canonicalItem.quantity;
  return typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function calculateComparisonTotals(rows: ComparisonRunItem[]): ComparisonRunTotals {
  const kTotal = rows.reduce((sum, row) => sum + (row.kMatch?.candidate?.price ?? 0) * getItemQuantity(row), 0);
  const sTotal = rows.reduce((sum, row) => sum + (row.sMatch?.candidate?.price ?? 0) * getItemQuantity(row), 0);

  return {
    kTotal: roundMoney(kTotal),
    sTotal: roundMoney(sTotal),
    difference: roundMoney(kTotal - sTotal),
    matchedItems: rows.filter((row) => row.status === "matched").length,
    ambiguousItems: rows.filter((row) => row.status === "ambiguous").length,
    missingItems: rows.filter((row) => row.status === "not_found" || row.status === "mismatch").length,
  };
}
