/**
 * Per-purchase ephemeral key + payment-id minting for the W3S Coinage flow.
 *
 * Each sale gets a fresh P-256 keypair and a fresh payment id (Appendix F of
 * "Merchant Payments W3S - Host & Terminal"). The terminal publishes the
 * COMPRESSED public key in the deeplink QR and keeps the private key in memory
 * to decrypt the incoming "cheque" envelope.
 *
 * Entropy: per the spec we source it from the host (`deriveEntropy`) when
 * running inside the Polkadot app. `deriveEntropy` is deterministic in its
 * input, so we feed it a fresh random label to get a fresh key each time, and
 * fall back to the label itself (browser CSPRNG) when standalone/dev.
 */

import { p256 } from "@noble/curves/nist.js";
import { deriveEntropy } from "@novasamatech/host-api-wrapper";

export interface EphemeralKeypair {
  /** 32-byte P-256 private scalar — kept in memory, never leaves the device. */
  readonly privateKey: Uint8Array;
  /** 33-byte SEC1-compressed public key — goes in the deeplink `key=`. */
  readonly publicKeyCompressed: Uint8Array;
}

async function freshEntropy(): Promise<Uint8Array> {
  const label = crypto.getRandomValues(new Uint8Array(32));
  try {
    const result = await deriveEntropy(label);
    if (result.isOk() && result.value.length >= 32) {
      return result.value.slice(0, 32);
    }
  } catch {
    // Host bridge unavailable (standalone/dev) — fall through to the CSPRNG
    // label, which is itself 32 bytes of secure randomness.
  }
  return label;
}

/**
 * Mint a fresh P-256 keypair. Retries on the astronomically-unlikely chance
 * the derived 32 bytes fall outside the valid scalar range.
 */
export async function generateEphemeralKeypair(): Promise<EphemeralKeypair> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const privateKey = await freshEntropy();
    try {
      const publicKeyCompressed = p256.getPublicKey(privateKey, true);
      return { privateKey, publicKeyCompressed };
    } catch {
      // invalid scalar — derive again
    }
  }
  throw new Error("failed to derive a valid P-256 keypair after 8 attempts");
}

/**
 * A fresh payment id: 32 lowercase hex chars. Non-empty, lowercase
 * alphanumeric, and unique per purchase (Appendix F).
 */
export function generatePaymentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
