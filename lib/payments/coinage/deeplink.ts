/**
 * pay/cheque deeplink builder + amount helpers.
 *
 *   polkadotapp://pay/cheque?id=<id>&amount=<amount>&key=<key>[&name=<name>]
 *
 * NOTE: the original spec (Appendix F) used `polkadotapp://w3spay.dot/pay-w3s`,
 * but the Polkadot App moved the native handler to the `pay` host / `/cheque`
 * path (Android PR #757 `W3sPayDeepLinkHandler`). A `*.dot` host is intercepted
 * by the wildcard product-SPA handler and opened in the in-app browser, so it
 * never reaches the native cheque flow — the `pay/cheque` form is required.
 *
 * - `id`:     non-empty, alphanumeric only (Android `id.all(isLetterOrDigit)`).
 * - `amount`: decimal string, ≤ 2 places, value ≤ 10000.
 * - `key`:    Base64URL of the COMPRESSED ephemeral P-256 public key (33 bytes).
 * - `name`:   optional URL-encoded recipient label shown to the payer.
 */

export const PAY_W3S_DEEPLINK_BASE = "polkadotapp://pay/cheque";

/** Max payable amount per the spec. */
export const MAX_AMOUNT = 10000;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Normalize a calculator amount ("12", "12.5", "12.50") to exactly two decimal
 * places ("12.00", "12.50"). This matches the `W3sPaymentDataV1.amount` shape
 * the Android sender emits (`/^\d+\.\d{2}$/`), so the deeplink amount and the
 * decrypted-payload amount compare byte-for-byte.
 */
export function normalizeAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(amount)}`);
  }
  if (n > MAX_AMOUNT) {
    throw new Error(`amount exceeds max ${MAX_AMOUNT}: ${amount}`);
  }
  return n.toFixed(2);
}

export interface PayW3sDeeplinkParams {
  id: string;
  /** Decimal amount; will be normalized to 2dp. */
  amount: string;
  /** Compressed (33-byte) P-256 public key. */
  publicKeyCompressed: Uint8Array;
  /** Optional recipient label shown to the payer (e.g. the shop name). */
  name?: string;
}

export function buildPayW3sDeeplink(params: PayW3sDeeplinkParams): string {
  if (!params.id || !/^[a-zA-Z0-9]+$/.test(params.id)) {
    // Android requires `id.all(Char::isLetterOrDigit)`; reject early so a bad
    // id surfaces here instead of silently failing to route on the phone.
    throw new Error(`payment id must be non-empty alphanumeric: ${JSON.stringify(params.id)}`);
  }
  const search = new URLSearchParams({
    id: params.id,
    amount: normalizeAmount(params.amount),
    key: base64url(params.publicKeyCompressed),
  });
  if (params.name && params.name.trim()) {
    search.set("name", params.name.trim());
  }
  return `${PAY_W3S_DEEPLINK_BASE}?${search.toString()}`;
}
