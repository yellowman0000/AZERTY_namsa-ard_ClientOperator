export function formatDateTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function formatLiters(value: number) {
  // Up to 4 decimals: the checksum covers the volume to 4 decimal places.
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} L`;
}

export function formatAmount(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Same as formatAmount, with an explicit sign so a shortfall reads as one. */
export function formatSignedAmount(value: number) {
  const amount = formatAmount(Math.abs(value));
  if (value < 0) return `-${amount}`;
  if (value > 0) return `+${amount}`;
  return amount;
}

/** A ratio (0.0123) as a percentage ("1.2%"). */
export function formatPercent(ratio: number, digits = 1) {
  return `${(ratio * 100).toFixed(digits)}%`;
}
