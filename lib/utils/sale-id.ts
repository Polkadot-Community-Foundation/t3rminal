import { ulid, monotonicFactory } from "ulid";

/**
 * ULID-based SaleId Generator
 *
 * SaleId is a unique identifier for each sale using ULID (Universally Unique Lexicographically Sortable Identifier).
 * ULID includes an embedded millisecond timestamp, enabling deterministic ordering of sales
 * and efficient event matching without relying on additional time fields.
 *
 * Format:
 * - 26 characters
 * - Crockford Base32 (uppercase)
 * - Lexicographically sortable by creation time
 * - Example: 01HZY7G3B6F9X8MZQY2KJ3N8V4
 *
 * On-chain Encoding:
 * SaleId is written to the remark in the following format: T3:<SALE_ULID>
 */

// Monotonic ULID generator to avoid collisions within the same millisecond
const monotonic = monotonicFactory();

/**
 * Generate a new ULID-based SaleId
 * Uses monotonic factory to ensure unique IDs even when generated within the same millisecond
 */
export function generateSaleId(): string {
  return monotonic();
}

/**
 * Generate a simple ULID (non-monotonic)
 * Use generateSaleId() for production to ensure collision resistance
 */
export function generateSimpleSaleId(): string {
  return ulid();
}

/**
 * Validate ULID-based SaleId format
 * ULID is 26 characters using Crockford Base32 (excludes I, L, O, U to avoid confusion)
 */
export function isValidSaleId(saleId: string): boolean {
  // ULID uses Crockford Base32: 0-9 and A-Z excluding I, L, O, U
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(saleId);
}

/**
 * Format SaleId with T3: prefix for on-chain remark
 * Per Design Doc spec: T3:<SALE_ULID>
 */
export function formatSaleIdForRemark(saleId: string): string {
  return `T3:${saleId}`;
}

/**
 * Extract SaleId from remark string
 * Looks for T3: prefix followed by 26-character ULID
 */
export function extractSaleIdFromRemark(remark: string): string | null {
  const match = remark.match(/T3:([0-9A-HJKMNP-TV-Z]{26})/);
  return match ? match[1] : null;
}

/**
 * Extract timestamp from ULID
 * First 10 characters of ULID encode the timestamp in milliseconds
 */
export function getTimestampFromSaleId(saleId: string): Date | null {
  if (!isValidSaleId(saleId)) {
    return null;
  }

  // Crockford Base32 decoding table
  const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  // Decode first 10 characters (timestamp portion)
  let timestamp = 0;
  for (let i = 0; i < 10; i++) {
    const charIndex = ENCODING.indexOf(saleId[i]);
    if (charIndex === -1) return null;
    timestamp = timestamp * 32 + charIndex;
  }

  return new Date(timestamp);
}

/**
 * Get the last N characters of a SaleId for display/search purposes
 * Useful for customer verbal confirmation (per Design Doc UX consideration)
 */
export function getSaleIdSuffix(saleId: string, chars: number = 4): string {
  return saleId.slice(-chars);
}

/**
 * Compare two SaleIds chronologically
 * Since ULIDs are lexicographically sortable, we can use string comparison
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareSaleIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ============================================
// Legacy functions for backwards compatibility
// ============================================

/**
 * @deprecated Use generateSaleId() instead
 * Generate a 6-character alphanumeric sale ID (legacy format)
 */
export function generateShortSaleId(): string {
  // Now returns full ULID for consistency
  return generateSaleId();
}
