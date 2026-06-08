/**
 * ECIES decryption for the W3S Coinage "cheque" (terminal side).
 *
 * Matches the customer-app sender's envelope (see codec.ts for the shared
 * wire contract):
 *
 *   shared_secret = ECDH_x(merchantPriv, ephemeralPubUncompressed)   // 32B raw X
 *   aes_key       = HKDF-SHA256(IKM=shared_secret, salt=∅, info=∅, L=32)
 *   plaintext     = AES-256-GCM-decrypt(aes_key, iv=blob[0..12], blob[12..])
 */
import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  decodeW3sEncryptedPayloadV1,
  decodeW3sPaymentDataV1,
  type W3sEncryptedPayloadV1,
  type W3sPaymentDataV1,
} from "./codec";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const SHARED_SECRET_BYTES = 32;
const AES_KEY_BYTES = 32;
const COMPRESSED_PUB_BYTES = 33;
const UNCOMPRESSED_PUB_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;
const EMPTY = new Uint8Array(0);

export class EciesError extends Error {
  override readonly name = "EciesError";
}

/**
 * Derive the AES-256-GCM key protecting an envelope, given a P-256 private key
 * and the counterparty's uncompressed public key (`0x04 ‖ X ‖ Y`). Symmetric:
 * works for both the merchant-decrypt and sender-encrypt directions.
 */
export function deriveAesKey(
  privKey: Uint8Array,
  pubUncompressed: Uint8Array,
): Uint8Array {
  if (privKey.length !== PRIVATE_KEY_BYTES) {
    throw new EciesError(
      `privKey must be ${PRIVATE_KEY_BYTES} bytes (got ${privKey.length})`,
    );
  }
  if (pubUncompressed.length !== UNCOMPRESSED_PUB_BYTES || pubUncompressed[0] !== 0x04) {
    throw new EciesError(
      `pub must be ${UNCOMPRESSED_PUB_BYTES} bytes uncompressed (prefix 0x04)`,
    );
  }

  // Force compressed ECDH output and drop the SEC1 prefix to get the raw 32-byte
  // X coordinate — byte-for-byte identical to the Android Java ECDH result.
  const sharedPoint = p256.getSharedSecret(privKey, pubUncompressed, true);
  if (sharedPoint.length !== COMPRESSED_PUB_BYTES) {
    throw new EciesError(`ECDH shared point unexpected length: ${sharedPoint.length}`);
  }
  const sharedSecret = sharedPoint.subarray(1, 1 + SHARED_SECRET_BYTES);

  const aesKey = hkdf(sha256, sharedSecret, EMPTY, EMPTY, AES_KEY_BYTES);
  if (aesKey.length !== AES_KEY_BYTES) {
    throw new EciesError(`HKDF output unexpected length: ${aesKey.length}`);
  }
  return aesKey;
}

/** Decrypt the IV-prefixed AES-256-GCM blob (`IV(12) ‖ ciphertext ‖ tag(16)`). */
export function decryptAesGcmBlob(aesKey: Uint8Array, blob: Uint8Array): Uint8Array {
  if (aesKey.length !== AES_KEY_BYTES) {
    throw new EciesError(`aesKey must be ${AES_KEY_BYTES} bytes (got ${aesKey.length})`);
  }
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new EciesError(
      `encryptedData too short (need ≥${IV_BYTES + TAG_BYTES}, got ${blob.length})`,
    );
  }
  const iv = blob.subarray(0, IV_BYTES);
  const cipherAndTag = blob.subarray(IV_BYTES);
  try {
    return gcm(aesKey, iv).decrypt(cipherAndTag);
  } catch (cause) {
    throw new EciesError("AES-GCM decryption failed (bad key, IV, or tag)", { cause });
  }
}

/**
 * End-to-end: SCALE-decode the envelope, ECDH against the terminal's P-256
 * private key, AES-GCM decrypt, SCALE-decode the payload.
 */
export function decryptStatementData(
  merchantPrivKey: Uint8Array,
  envelopeBytes: Uint8Array,
): { envelope: W3sEncryptedPayloadV1; payload: W3sPaymentDataV1 } {
  const envelope = decodeW3sEncryptedPayloadV1(envelopeBytes);
  const aesKey = deriveAesKey(merchantPrivKey, envelope.ephemeralPublicKey);
  const plaintext = decryptAesGcmBlob(aesKey, envelope.encryptedData);
  const payload = decodeW3sPaymentDataV1(plaintext);
  return { envelope, payload };
}

/** Decompress a 33-byte SEC1-compressed P-256 pubkey to 65-byte uncompressed. */
export function decompressP256(compressedPub: Uint8Array): Uint8Array {
  if (
    compressedPub.length !== COMPRESSED_PUB_BYTES ||
    (compressedPub[0] !== 0x02 && compressedPub[0] !== 0x03)
  ) {
    throw new EciesError(`compressedPub must be ${COMPRESSED_PUB_BYTES} bytes (prefix 0x02|0x03)`);
  }
  const point = p256.Point.fromBytes(compressedPub);
  const out = point.toBytes(false);
  if (out.length !== UNCOMPRESSED_PUB_BYTES || out[0] !== 0x04) {
    throw new EciesError(
      `decompressed point unexpected shape (len=${out.length}, prefix=${out[0]?.toString(16) ?? "??"})`,
    );
  }
  return out;
}

/** Compress a 65-byte uncompressed P-256 pubkey to the 33-byte SEC1 form. */
export function compressP256(uncompressedPub: Uint8Array): Uint8Array {
  if (uncompressedPub.length !== UNCOMPRESSED_PUB_BYTES || uncompressedPub[0] !== 0x04) {
    throw new EciesError(`uncompressedPub must be ${UNCOMPRESSED_PUB_BYTES} bytes (prefix 0x04)`);
  }
  const point = p256.Point.fromBytes(uncompressedPub);
  return point.toBytes(true);
}
