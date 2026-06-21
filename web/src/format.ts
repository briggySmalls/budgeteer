/** Format a number as GBP with two decimals, e.g. £64,432.85. */
export function formatGBP(value: number): string {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
