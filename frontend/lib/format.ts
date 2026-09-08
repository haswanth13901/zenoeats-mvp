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
