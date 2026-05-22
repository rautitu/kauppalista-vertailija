export const ITEM_PROGRESS_START_PERCENT = 10;
export const ITEM_PROGRESS_END_PERCENT = 50;
const ITEM_PROGRESS_TICK_MS = 1_200;

export type ComparisonProgress = {
  percent: number;
  label: string;
  detail: string;
  status: "idle" | "running" | "complete" | "error";
};

export function calculateItemProgressPercent(completedItems: number, totalItems: number) {
  if (totalItems <= 0 || completedItems <= 0) {
    return ITEM_PROGRESS_START_PERCENT;
  }

  const clampedCompletedItems = Math.min(completedItems, totalItems);
  const itemProgressRange = ITEM_PROGRESS_END_PERCENT - ITEM_PROGRESS_START_PERCENT;

  return ITEM_PROGRESS_START_PERCENT + Math.round((clampedCompletedItems / totalItems) * itemProgressRange);
}

export function scheduleItemProgress(
  terms: string[],
  logProgress: (progress: ComparisonProgress) => void,
) {
  let isActive = true;
  const timers = terms.map((term, index) =>
    window.setTimeout(
      () => {
        if (!isActive) {
          return;
        }

        const completedItems = index + 1;
        logProgress({
          percent: calculateItemProgressPercent(completedItems, terms.length),
          label: "Haetaan tuotteita",
          detail: `${completedItems}/${terms.length}: ${term}`,
          status: "running",
        });
      },
      ITEM_PROGRESS_TICK_MS * (index + 1),
    ),
  );

  return () => {
    isActive = false;
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
  };
}
