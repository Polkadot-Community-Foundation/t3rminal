import { blake2b } from "@noble/hashes/blake2.js";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import type { MultihashDigest } from "multiformats/hashes/interface";

const BLAKE2B_256_CODE = 0xb220;

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let num = value;
  while (num >= 0x80) {
    bytes.push((num & 0x7f) | 0x80);
    num >>= 7;
  }
  bytes.push(num & 0x7f);
  return new Uint8Array(bytes);
}

/**
 * Calculate CID (Content Identifier) for a file using Blake2b-256 hash.
 * Same file always gives the same CID (content-addressed).
 */
export function calculateCID(fileBytes: Uint8Array): string {
  // Blake2b-256 hash (32 bytes)
  const hash = blake2b(fileBytes, { dkLen: 32 });

  // Encode as multihash format: varint(code) + varint(length) + hash
  const codeBytes = encodeVarint(BLAKE2B_256_CODE);
  const lengthBytes = encodeVarint(hash.length);

  const multihashBytes = new Uint8Array(
    codeBytes.length + lengthBytes.length + hash.length
  );
  multihashBytes.set(codeBytes, 0);
  multihashBytes.set(lengthBytes, codeBytes.length);
  multihashBytes.set(hash, codeBytes.length + lengthBytes.length);

  const digest: MultihashDigest = {
    code: BLAKE2B_256_CODE,
    size: hash.length,
    bytes: multihashBytes,
    digest: hash,
  };

  // Create CIDv1 with raw codec
  return CID.createV1(raw.code, digest).toString();
}

/**
 * Derive the Bulletin preimage lookup key from a CID.
 *
 * Bulletin content-addresses preimages by their Blake2b-256 digest — the same
 * digest `calculateCID` embeds in the CIDv1 multihash. So the key the host's
 * `preimageManager.lookup` expects (`0x…`) is exactly the CID's multihash
 * digest. Extract it rather than re-hashing the bytes, since at read time we
 * have the CID, not the original payload.
 */
export function cidToPreimageKey(cid: string): `0x${string}` {
  const digest = CID.parse(cid).multihash.digest;
  return ("0x" +
    Array.from(digest)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
}

/**
 * Convert CID string to bytes32 hash for smart contract storage
 */
export function cidToBytes32(cid: string): string {
  // Hash the CID string to get a 32-byte value for the contract
  const encoder = new TextEncoder();
  const cidBytes = encoder.encode(cid);
  const hash = blake2b(cidBytes, { dkLen: 32 });
  return "0x" + Array.from(hash).map((b: number) => b.toString(16).padStart(2, "0")).join("");
}
