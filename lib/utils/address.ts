import { decodeAddress, encodeAddress } from "@polkadot/util-crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";

// SS58 prefix 42 = Generic Substrate format (addresses start with "5")
const SUBSTRATE_SS58_PREFIX = 42;

const EVM_DERIVED_MARKER = 0xee;
const H160_BYTE_LEN = 20;
const ACCOUNTID_BYTE_LEN = 32;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Derive the H160 EVM address from a 32-byte Substrate public key.
 *
 * Asset Hub pallet-revive rules:
 *  - EVM-derived (last 12 bytes are 0xEE): strip padding to recover original H160.
 *  - Native (sr25519/ed25519): keccak256(publicKey), take last 20 bytes.
 */
export function deriveH160(publicKey: Uint8Array): string {
  if (publicKey.length !== ACCOUNTID_BYTE_LEN) {
    throw new Error(`Expected ${ACCOUNTID_BYTE_LEN}-byte public key, got ${publicKey.length} bytes`);
  }
  const isEvmDerived = publicKey.slice(H160_BYTE_LEN).every((b) => b === EVM_DERIVED_MARKER);
  if (isEvmDerived) return `0x${bytesToHex(publicKey.slice(0, H160_BYTE_LEN))}`;
  const hash = keccak_256(publicKey);
  return `0x${bytesToHex(hash.slice(ACCOUNTID_BYTE_LEN - H160_BYTE_LEN, ACCOUNTID_BYTE_LEN))}`;
}

/** Convert an SS58 address to its H160 EVM address. */
export function ss58ToH160(address: string): string {
  const publicKey = decodeAddress(address);
  return deriveH160(publicKey);
}

/**
 * Normalize address to generic Substrate format (prefix 42)
 * This ensures all addresses are displayed consistently as "5F...", "5G...", etc.
 */
export function normalizeToAssetHubAddress(address: string): string {
  try {
    const publicKey = decodeAddress(address);
    const normalized = encodeAddress(publicKey, SUBSTRATE_SS58_PREFIX);
    return normalized;
  } catch (error) {
    console.error("[normalizeToAssetHubAddress] Failed to normalize address:", address, error);
    return address;
  }
}

/**
 * Convert SS58 Substrate address to EVM address (0x format)
 * Takes the first 20 bytes of the public key
 */
export function ss58ToEvmAddress(ss58Address: string): string {
  try {
    const publicKey = decodeAddress(ss58Address);
    // Take first 20 bytes and convert to hex
    const evmBytes = publicKey.slice(0, 20);
    const hex = Array.from(evmBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return "0x" + hex;
  } catch (error) {
    console.error("[ss58ToEvmAddress] Failed to convert address:", ss58Address, error);
    return ss58Address;
  }
}

/**
 * Shorten address for display (e.g., "5Gw3s...7Xt4")
 */
export function shortenAddress(address: string, startChars = 6, endChars = 4): string {
  if (address.length <= startChars + endChars) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}
