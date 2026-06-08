/**
 * Hybrid report encryption
 *
 * Uses XChaCha20-Poly1305 for the report (fast, large data) and
 * NaCl sealed box for per-recipient key wrapping (asymmetric, small data).
 *
 * Format:
 *   1. Generate random 32-byte reportKey
 *   2. Encrypt report with XChaCha20: nonce(24) || ciphertext
 *   3. For each recipient: sealedBoxEncrypt(reportKey, recipientPubKey)
 *   4. Package as JSON: { v, encrypted, recipients[] }
 */

"use client"

import {
  xchachaEncryptPacked,
  xchachaDecryptPacked,
  sealedBoxEncrypt,
  sealedBoxDecrypt,
  randomBytes,
} from "@/lib/crypto/primitives"

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return bytes
}
import type { Recipient } from "./keys"

export interface EncryptedReport {
  /** Format version */
  v: 1
  /** XChaCha20-Poly1305 encrypted report: hex(nonce(24) || ciphertext) */
  encrypted: string
  /** Per-recipient wrapped keys */
  recipients: Array<{
    pubkey: string  // hex
    wrappedKey: string  // hex(sealedBox(reportKey))
  }>
  /** Unencrypted metadata (for display without decryption) */
  meta: {
    date: string
    txCount: number
    terminal: string
    encryptedAt: string
  }
}

/**
 * Encrypt a daily report for multiple recipients.
 *
 * @param reportJson - The full report as a JSON string
 * @param recipients - List of recipients who can decrypt
 * @param meta - Unencrypted metadata for display
 * @returns EncryptedReport structure ready for upload
 */
export function encryptReport(
  reportJson: string,
  recipients: Recipient[],
  meta: { date: string; txCount: number; terminal: string }
): EncryptedReport {
  if (recipients.length === 0) {
    throw new Error("At least one recipient required for encryption")
  }

  // 1. Generate random one-time key
  const reportKey = randomBytes(32)

  // 2. Encrypt report with XChaCha20 (packed: nonce || ciphertext)
  const reportBytes = new TextEncoder().encode(reportJson)
  const encryptedPacked = xchachaEncryptPacked(reportBytes, reportKey)

  // 3. Wrap reportKey for each recipient with sealed box
  const wrappedRecipients = recipients.map((r) => {
    const pubkey = hexToBytes(r.pubkeyHex)
    const wrappedKey = sealedBoxEncrypt(reportKey, pubkey)
    return {
      pubkey: r.pubkeyHex,
      wrappedKey: bytesToHex(wrappedKey),
    }
  })

  // 4. Zeroize reportKey from memory
  reportKey.fill(0)

  return {
    v: 1,
    encrypted: bytesToHex(encryptedPacked),
    recipients: wrappedRecipients,
    meta: {
      ...meta,
      encryptedAt: new Date().toISOString(),
    },
  }
}

/**
 * Decrypt a report using this terminal's secret key.
 *
 * @param envelope - The encrypted report envelope
 * @param myPubkeyHex - This terminal's public key (to find wrapped key)
 * @param mySecretKey - This terminal's secret key (to unwrap)
 * @returns Decrypted report as JSON string
 */
export function decryptReport(
  envelope: EncryptedReport,
  myPubkeyHex: string,
  mySecretKey: Uint8Array
): string {
  // 1. Find our wrapped key
  const myEntry = envelope.recipients.find(
    (r) => r.pubkey === myPubkeyHex.toLowerCase()
  )
  if (!myEntry) {
    throw new Error("This terminal is not authorized to decrypt this report")
  }

  // 2. Unwrap reportKey with our secret key
  const wrappedKey = hexToBytes(myEntry.wrappedKey)
  const reportKey = sealedBoxDecrypt(wrappedKey, mySecretKey)

  // 3. Decrypt report with XChaCha20
  const encryptedPacked = hexToBytes(envelope.encrypted)
  const reportBytes = xchachaDecryptPacked(encryptedPacked, reportKey)

  // 4. Zeroize reportKey
  reportKey.fill(0)

  return new TextDecoder().decode(reportBytes)
}

/**
 * Check if an object looks like an encrypted report envelope.
 */
export function isEncryptedReport(data: unknown): data is EncryptedReport {
  if (!data || typeof data !== "object") return false
  const d = data as Record<string, unknown>
  return d.v === 1 && typeof d.encrypted === "string" && Array.isArray(d.recipients)
}
