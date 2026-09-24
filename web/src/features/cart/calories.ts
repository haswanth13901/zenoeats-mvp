/**
 * What a dish contains, as the restaurant states it.
 *
 * Optional everywhere: a restaurant that has not worked out a figure states
 * none, and a menu must then say nothing rather than imply zero.
 */

type Stated = { calories?: number | null };

/** "540 kcal", or null where there is no figure to show. */
export function kcal(value: number | null | undefined): string | null {
  return typeof value === "number" ? `${value.toLocaleString("en-US")} kcal` : null;
}

/**
 * A combo's total, added up from the items chosen for it so far.
 *
 * Null unless every chosen item states a figure. A total that quietly left
 * out the one dish with no figure would be a smaller number than the meal,
 * presented as if it were the meal -- worse than showing nothing, because a
 * customer counting calories would believe it.
 *
 * Modifier options are not counted: they carry no figure of their own, so a
 * total including them would be the same claim with extra confidence.
 */
export function comboCalories(chosen: Stated[]): number | null {
  if (!chosen.length) return null;
  let total = 0;
  for (const item of chosen) {
    if (typeof item.calories !== "number") return null;
    total += item.calories;
  }
  return total;
}
