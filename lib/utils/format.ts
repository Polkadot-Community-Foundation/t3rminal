const POLKADOT_DECIMALS = 6; // pUSD on Paseo Individuality (genesis metadata)

/**
 * Convert planck (smallest unit) to human-readable amount
 * @param amountInPlanck - Amount in planck (smallest unit)
 * @param decimals - Number of decimals (default: 18 for pUSD)
 * @returns Formatted amount string
 */
export function formatAmountFromPlanck(amountInPlanck: string | bigint, decimals: number = POLKADOT_DECIMALS): string {
  try {
    const bigAmount = typeof amountInPlanck === 'string' ? BigInt(amountInPlanck) : amountInPlanck;
    const divisor = BigInt(10) ** BigInt(decimals);
    const wholeAmount = bigAmount / divisor;
    const remainder = bigAmount % divisor;

    // Format with proper decimals
    const formattedRemainder = remainder.toString().padStart(decimals, "0");
    // Drop trailing zeros, but always keep at least 2 decimal places so money
    // renders consistently everywhere ("6" → "6.00", "7.5" → "7.50"). Values
    // with sub-cent precision keep their extra digits ("5.123456").
    const trimmed = formattedRemainder.replace(/0+$/, "");
    const fraction = trimmed.length < 2 ? trimmed.padEnd(2, "0") : trimmed;
    return `${wholeAmount}.${fraction}`;
  } catch (error) {
    console.error("[formatAmountFromPlanck] Error formatting amount:", error);
    return amountInPlanck.toString(); // Fallback to original if conversion fails
  }
}

/**
 * Display a decimal amount string with exactly two decimals so money reads
 * consistently in lists and exports ("5.5" → "5.50", "6" → "6.00"). Records
 * stored before consistent formatting flow through here too. Non-numeric
 * input passes through untouched.
 */
export function formatMoney(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : amount;
}

/**
 * Convert human-readable amount to planck (smallest unit)
 * @param amount - Human-readable amount (e.g., "1.5")
 * @param decimals - Number of decimals (default: 10 for Polkadot)
 * @returns Amount in planck as BigInt
 */
export function amountToPlanck(amount: string | number, decimals: number = POLKADOT_DECIMALS): bigint {
  const amountStr = typeof amount === 'number' ? amount.toString() : amount;
  const [whole, decimal = "0"] = amountStr.split(".");

  // Pad or trim decimal part to match decimals
  const decimalPart = decimal.padEnd(decimals, "0").slice(0, decimals);
  const fullAmount = whole + decimalPart;

  return BigInt(fullAmount);
}
