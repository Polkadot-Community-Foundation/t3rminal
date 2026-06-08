/**
 * Shared span operation names used across the app.
 *
 * Convention: `<domain>.<action>` (e.g., `api.fetch`, `blockchain.tx`)
 * — keep names short and grep-friendly so Sentry filters stay readable.
 */

export const SpanOp = {
  // API / Network
  API_FETCH: "api.fetch",
  API_MUTATION: "api.mutation",

  // Storage
  STORAGE_READ: "storage.read",
  STORAGE_WRITE: "storage.write",

  // Auth
  AUTH_LOGIN: "auth.login",
  AUTH_REGISTER: "auth.register",
  AUTH_SESSION_RESTORE: "auth.session.restore",

  // Blockchain — t3rminal-specific. Pallet calls vs. read queries are
  // tracked separately so we can spot signing/wait latency without it
  // being averaged into cheap state reads.
  BLOCKCHAIN_QUERY: "blockchain.query",
  BLOCKCHAIN_TX: "blockchain.tx",
  CONTRACT_READ: "contract.read",
  CONTRACT_WRITE: "contract.write",

  // Bulletin / IPFS
  IPFS_UPLOAD: "ipfs.upload",
  IPFS_FETCH: "ipfs.fetch",

  // Crypto
  CRYPTO_ENCRYPT: "crypto.encrypt",
  CRYPTO_DECRYPT: "crypto.decrypt",

  // Receipt / UI
  RECEIPT_GENERATE: "receipt.generate",
} as const;

export type SpanOpValue = (typeof SpanOp)[keyof typeof SpanOp];
