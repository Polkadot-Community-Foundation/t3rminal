/**
 * SCALE codecs for the W3S Coinage "cheque" wire format.
 *
 * Mirrors the Android sender (`W3sPaymentScale.kt`). The encoding is the wire
 * contract shared with the customer app; if it changes, update both ends.
 *
 * Binding rules: `ByteArray` → `Vec<u8>` (compact len + bytes); `@FixedLength(N)`
 * → exactly N raw bytes; `String` → `Vec<u8>` UTF-8; `ULong` → `u64` LE;
 * `List<T>` → `Vec<T>`. Field order is the contract — do not reorder.
 */
import { Bytes, Struct, Vector, str, u64 } from "scale-ts";

/** Statement-store envelope. Wire field order: encryptedData, ephemeralPublicKey. */
export interface W3sEncryptedPayloadV1 {
  /** AES-256-GCM(IV(12) ‖ ciphertext ‖ tag(16)) over SCALE(W3sPaymentDataV1). */
  encryptedData: Uint8Array;
  /** Raw uncompressed P-256 point (0x04 ‖ X(32) ‖ Y(32)). Exactly 65 bytes. */
  ephemeralPublicKey: Uint8Array;
}

/** Decrypted payment payload. Wire field order: amount, timestamp, coins, id. */
export interface W3sPaymentDataV1 {
  /** Decimal string with "." separator and exactly two decimal places (HALF_UP). */
  amount: string;
  /** Sender wall-clock at submission time, in unix milliseconds. */
  timestamp: bigint;
  /**
   * Coin secret keys claimed by this payment. Each is exactly 64 bytes: the
   * sr25519 secret = 32-byte scalar ‖ 32-byte nonce, as the Android sender
   * emits (`TransferMemoBuilder`: `keyPair.privateKey + keyPair.nonce`) and as
   * the host consumes it (`createKeypairFromSecret`, host-api `Sr25519SecretKey
   * = Bytes(64)`).
   */
  coins: Uint8Array[];
  /** Payment id (the deeplink `id`). */
  id: string;
}

export const W3sEncryptedPayloadV1Codec = Struct({
  encryptedData: Bytes(),
  ephemeralPublicKey: Bytes(65),
});

export const W3sPaymentDataV1Codec = Struct({
  amount: str,
  timestamp: u64,
  coins: Vector(Bytes()),
  id: str,
});

export const encodeW3sEncryptedPayloadV1 = (
  payload: W3sEncryptedPayloadV1,
): Uint8Array => {
  assertEphemeralKeyShape(payload.ephemeralPublicKey);
  return W3sEncryptedPayloadV1Codec.enc(payload);
};

export const decodeW3sEncryptedPayloadV1 = (
  bytes: Uint8Array,
): W3sEncryptedPayloadV1 => {
  const decoded = W3sEncryptedPayloadV1Codec.dec(bytes);
  assertEphemeralKeyShape(decoded.ephemeralPublicKey);
  return decoded;
};

export const encodeW3sPaymentDataV1 = (
  payload: W3sPaymentDataV1,
): Uint8Array => {
  assertAmountShape(payload.amount);
  for (const coin of payload.coins) {
    if (coin.length !== COIN_SECRET_BYTES) {
      throw new CodecError(`coins[i] must be exactly ${COIN_SECRET_BYTES} bytes (got ${coin.length})`);
    }
  }
  return W3sPaymentDataV1Codec.enc(payload);
};

export const decodeW3sPaymentDataV1 = (bytes: Uint8Array): W3sPaymentDataV1 => {
  const decoded = W3sPaymentDataV1Codec.dec(bytes);
  assertAmountShape(decoded.amount);
  for (const [i, coin] of decoded.coins.entries()) {
    if (coin.length !== COIN_SECRET_BYTES) {
      throw new CodecError(`coins[${i}] must be exactly ${COIN_SECRET_BYTES} bytes (got ${coin.length})`);
    }
  }
  return decoded;
};

/**
 * Each coin secret key is a 64-byte sr25519 secret (scalar ‖ nonce). See
 * `coins` in W3sPaymentDataV1 for the cross-references to the Android sender/host.
 */
export const COIN_SECRET_BYTES = 64;

/** Thrown when bytes do not match the wire contract. */
export class CodecError extends Error {
  override readonly name = "CodecError";
}

function assertEphemeralKeyShape(bytes: Uint8Array): void {
  if (bytes.length !== 65) {
    throw new CodecError(`ephemeralPublicKey must be 65 bytes (got ${bytes.length})`);
  }
  if (bytes[0] !== 0x04) {
    throw new CodecError(
      `ephemeralPublicKey must be uncompressed (prefix 0x04, got 0x${bytes[0]?.toString(16) ?? "??"})`,
    );
  }
}

const AMOUNT_RE = /^\d+\.\d{2}$/;
function assertAmountShape(amount: string): void {
  if (!AMOUNT_RE.test(amount)) {
    throw new CodecError(
      `amount must match /^\\d+\\.\\d{2}$/ (got ${JSON.stringify(amount)})`,
    );
  }
}
