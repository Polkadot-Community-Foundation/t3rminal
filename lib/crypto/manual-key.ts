/**
 * Manual symmetric key for daily-report encryption.
 *
 * Merchant types a passphrase on the encryption settings page; we derive a
 * 32-byte key from it via SHA-256 and persist BOTH the passphrase and a
 * fingerprint in localStorage. The same key is used to encrypt new daily
 * reports and to decrypt reports read back from Bulletin.
 *
 * This is intentionally simple — symmetric, single secret, no recipient list,
 * no key exchange. It replaces the per-device public-key flow for now.
 */

"use client"

import { sha256 } from "@noble/hashes/sha2.js"

const PASSPHRASE_KEY = "t3rminal:manual-encryption-passphrase"

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** Derive the 32-byte symmetric key from a passphrase. */
export function deriveKeyFromPassphrase(passphrase: string): Uint8Array {
  return sha256(utf8(`t3rminal-manual-key:${passphrase.trim()}`))
}

export function setManualPassphrase(passphrase: string): void {
  if (typeof window === "undefined") return
  const trimmed = passphrase.trim()
  if (!trimmed) throw new Error("Passphrase cannot be empty")
  localStorage.setItem(PASSPHRASE_KEY, trimmed)
}

export function getManualPassphrase(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(PASSPHRASE_KEY)
}

export function clearManualPassphrase(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(PASSPHRASE_KEY)
}

export function hasManualKey(): boolean {
  return getManualPassphrase() !== null
}

/** Returns the derived 32-byte key, or null if no passphrase set. */
export function loadManualKey(): Uint8Array | null {
  const p = getManualPassphrase()
  if (!p) return null
  return deriveKeyFromPassphrase(p)
}

/**
 * Short, human-readable fingerprint of the current key (first 8 hex chars of
 * SHA-256 over the derived key). Lets the merchant verify "do two terminals
 * share the same key" without revealing the passphrase.
 */
export function manualKeyFingerprint(): string | null {
  const key = loadManualKey()
  if (!key) return null
  return bytesToHex(sha256(key)).slice(0, 8).toUpperCase()
}
