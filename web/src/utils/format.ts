/** Money arrives from the API as integer minor units. It is formatted for
 *  display here and nowhere else. Never do arithmetic on the formatted
 *  string, and never send a price back to the server. */
export function money(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minor / 100);
}

export function signedMoney(minor: number, currency = "USD"): string {
  if (minor === 0) return "";
  return `${minor > 0 ? "+" : "−"}${money(Math.abs(minor), currency)}`;
}

/**
 * Parse a price typed in major units into integer minor units.
 *
 * Returns null for anything that is not a plain non-negative amount. The
 * previous inline `Math.round(parseFloat(price) * 100)` turned "10,95" or a
 * stray currency symbol into NaN, which JSON.stringify writes as null, and
 * the server answered with an opaque 422 rather than saying the price was
 * unreadable.
 */
export function priceToMinor(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  // Scale as a string, not by multiplying: 10.95 * 100 is 1094.9999… in
  // binary floating point, and prices must not depend on rounding luck.
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * A price in minor units, as it should appear in an edit field.
 *
 * Not `money()`: that returns "$10.95", and a currency symbol typed back in
 * is exactly what `priceToMinor` refuses. This is the plain amount, so the
 * value round-trips through an input unchanged.
 */
export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * Parse a modifier's price change, which may be negative.
 *
 * Separate from priceToMinor because that one refuses a sign, correctly: an
 * item cannot cost less than nothing. A modifier can. "No cheese -0.50" is the
 * documented exception to the non-negative money rule, so this is the only
 * parser that accepts one.
 */
export function deltaToMinor(input: string): number | null {
  const trimmed = input.trim().replace(/\s+/g, "");
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.replace(/^[+-]/, "").split(".");
  // Scaled as a string, for the same reason priceToMinor does it: 0.50 * 100
  // is not exactly 50 in binary floating point.
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return trimmed.startsWith("-") ? -minor : minor;
}

/**
 * A price change as it should appear in an edit field.
 *
 * Not signedMoney(): that returns "" for zero and a currency symbol otherwise,
 * and both are exactly what deltaToMinor refuses to read back.
 */
export function minorToDeltaInput(minor: number): string {
  return `${minor < 0 ? "-" : ""}${(Math.abs(minor) / 100).toFixed(2)}`;
}

/**
 * A meal period's hours, as a customer reads them.
 *
 * Times arrive as HH:MM on a 24-hour clock and are shown on a 12-hour one,
 * matching the locale the prices already use. Both null, which is a
 * restaurant that has not said, comes back empty so a caller can leave the
 * line out entirely rather than print an empty range.
 *
 * An end at or before the start runs into the next day, and says so. Without
 * that, late night reads as "10:00 PM – 2:00 AM" and looks like a mistake
 * rather than the four hours it is.
 */
export function mealHours(
  starts: string | null,
  ends: string | null,
): string {
  if (!starts || !ends) return "";
  const label = `${clockLabel(starts)} – ${clockLabel(ends)}`;
  return ends <= starts ? `${label} (next day)` : label;
}

/** One HH:MM on a 12-hour clock. Anything unparseable is handed back as it
 *  came, so a surprise from the server is shown rather than swallowed. */
function clockLabel(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!match) return hhmm;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return hhmm;
  const at = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}
