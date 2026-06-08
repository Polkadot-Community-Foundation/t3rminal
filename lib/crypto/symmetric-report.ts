/**
 * Symmetric report encryption using the merchant's manual passphrase key.
 *
 * Replaces the older per-recipient hybrid envelope (see encrypt-report.ts).
 * Same XChaCha20-Poly1305 primitive, but the key comes from the manually
 * configured passphrase — no public keys, no recipient list.
 *
 * Envelope `v: 2` distinguishes this format from the `v: 1` recipient-based
 * envelopes so old reports still decrypt via the legacy path.
 */

"use client"

import {
  xchachaEncryptPacked,
  xchachaDecryptPacked,
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

export interface SymmetricEncryptedReport {
  v: 2
  /** XChaCha20-Poly1305: hex(nonce(24) || ciphertext) */
  encrypted: string
  meta: {
    date: string
    txCount: number
    terminal: string
    encryptedAt: string
    /** Short fingerprint of the key used (so a viewer can tell which key unlocks it). */
    keyFingerprint: string
  }
}

export function encryptReportSymmetric(
  reportJson: string,
  key: Uint8Array,
  meta: { date: string; txCount: number; terminal: string; keyFingerprint: string }
): SymmetricEncryptedReport {
  if (key.length !== 32) throw new Error("Symmetric key must be 32 bytes")
  const data = new TextEncoder().encode(reportJson)
  const packed = xchachaEncryptPacked(data, key)
  return {
    v: 2,
    encrypted: bytesToHex(packed),
    meta: {
      ...meta,
      encryptedAt: new Date().toISOString(),
    },
  }
}

export function decryptReportSymmetric(
  envelope: SymmetricEncryptedReport,
  key: Uint8Array
): string {
  if (key.length !== 32) throw new Error("Symmetric key must be 32 bytes")
  const packed = hexToBytes(envelope.encrypted)
  const plain = xchachaDecryptPacked(packed, key)
  return new TextDecoder().decode(plain)
}

export function isSymmetricEncryptedReport(data: unknown): data is SymmetricEncryptedReport {
  if (!data || typeof data !== "object") return false
  const d = data as Record<string, unknown>
  return d.v === 2 && typeof d.encrypted === "string" && typeof d.meta === "object"
}
