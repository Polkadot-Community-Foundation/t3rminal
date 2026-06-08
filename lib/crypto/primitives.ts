import nacl from "tweetnacl"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { randomBytes as nobleRandomBytes } from "@noble/hashes/utils.js"

export { default as nacl } from "tweetnacl"

export function randomBytes(length: number): Uint8Array {
  return nobleRandomBytes(length)
}

const PUBKEY_LEN = 32
const NONCE_LEN = 24
const SEALED_OVERHEAD = PUBKEY_LEN + NONCE_LEN

export function sealedBoxEncrypt(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  const ephemeral = nacl.box.keyPair()
  const nonce = nacl.randomBytes(NONCE_LEN)
  const encrypted = nacl.box(message, nonce, recipientPublicKey, ephemeral.secretKey)
  if (!encrypted) throw new Error("Encryption failed")
  const result = new Uint8Array(SEALED_OVERHEAD + encrypted.length)
  result.set(ephemeral.publicKey, 0)
  result.set(nonce, PUBKEY_LEN)
  result.set(encrypted, SEALED_OVERHEAD)
  return result
}

export function sealedBoxDecrypt(sealed: Uint8Array, recipientSecretKey: Uint8Array): Uint8Array {
  if (sealed.length < SEALED_OVERHEAD + nacl.box.overheadLength) {
    throw new Error("Sealed data too short")
  }
  const ephemeralPubKey = sealed.subarray(0, PUBKEY_LEN)
  const nonce = sealed.subarray(PUBKEY_LEN, SEALED_OVERHEAD)
  const ciphertext = sealed.subarray(SEALED_OVERHEAD)
  const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPubKey, recipientSecretKey)
  if (!decrypted) throw new Error("Decryption failed - invalid key or corrupted data")
  return decrypted
}

const KEY_LENGTH = 32
const XCHACHA_NONCE_LENGTH = 24

function validateKey(key: Uint8Array): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`ChaCha20-Poly1305 requires a 32-byte key, got ${key.length}`)
  }
}

/**
 * XChaCha20-Poly1305 encrypt with random 24-byte nonce, returning packed (nonce || ciphertext).
 */
export function xchachaEncryptPacked(data: Uint8Array, key: Uint8Array): Uint8Array {
  validateKey(key)
  const nonce = nobleRandomBytes(XCHACHA_NONCE_LENGTH)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(data)
  const result = new Uint8Array(XCHACHA_NONCE_LENGTH + ciphertext.length)
  result.set(nonce, 0)
  result.set(ciphertext, XCHACHA_NONCE_LENGTH)
  return result
}

export function xchachaDecryptPacked(packed: Uint8Array, key: Uint8Array): Uint8Array {
  validateKey(key)
  if (packed.length < XCHACHA_NONCE_LENGTH + 16) throw new Error("Packed data too short")
  const nonce = packed.subarray(0, XCHACHA_NONCE_LENGTH)
  const ciphertext = packed.subarray(XCHACHA_NONCE_LENGTH)
  const cipher = xchacha20poly1305(key, nonce)
  return cipher.decrypt(ciphertext)
}
