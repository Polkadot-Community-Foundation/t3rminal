import type { PolkadotSigner } from "polkadot-api"

import { captureError } from "@/lib/telemetry"

export type TxStatus = "signing" | "broadcasting" | "in-block" | "finalized" | "error"
export type WaitFor = "best-block" | "finalized"

export interface TxResult {
  txHash: string
  ok: boolean
  block: { hash: string; number: number; index: number }
  events: unknown[]
  dispatchError?: unknown
}

export interface SubmitOptions {
  waitFor?: WaitFor
  timeoutMs?: number
  mortalityPeriod?: number
  onStatus?: (status: TxStatus) => void
}

type TxEvent =
  | { type: "signed"; txHash: string }
  | { type: "broadcasted"; txHash: string }
  | {
      type: "txBestBlocksState"
      txHash: string
      found: boolean
      ok?: boolean
      events?: unknown[]
      block?: { hash: string; number: number; index: number }
      dispatchError?: unknown
    }
  | {
      type: "finalized"
      txHash: string
      ok: boolean
      events: unknown[]
      block: { hash: string; number: number; index: number }
      dispatchError?: unknown
    }

export interface SubmittableTransaction {
  signSubmitAndWatch: (
    signer: PolkadotSigner,
    options?: { mortality?: { mortal: boolean; period: number } }
  ) => {
    subscribe: (handlers: {
      next: (event: TxEvent) => void
      error: (error: Error) => void
    }) => { unsubscribe: () => void }
  }
  waited?: Promise<SubmittableTransaction>
  decodedCall?: unknown
}

export class TxError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "TxError"
  }
}

export class TxTimeoutError extends TxError {
  timeoutMs: number
  constructor(timeoutMs: number) {
    super(
      `Transaction timed out after ${timeoutMs / 1000}s. ` +
        "The transaction may still be processing on-chain."
    )
    this.name = "TxTimeoutError"
    this.timeoutMs = timeoutMs
  }
}

export class TxDispatchError extends TxError {
  dispatchError: unknown
  formatted: string
  constructor(dispatchError: unknown, formatted: string) {
    super(`Transaction dispatch failed: ${formatted}`)
    this.name = "TxDispatchError"
    this.dispatchError = dispatchError
    this.formatted = formatted
  }
}

export class TxSigningRejectedError extends TxError {
  constructor() {
    super("Transaction signing was rejected.")
    this.name = "TxSigningRejectedError"
  }
}

export class TxDryRunError extends TxError {
  raw: unknown
  formatted: string
  revertReason?: string
  constructor(raw: unknown, formatted: string, revertReason?: string) {
    super(revertReason ? `Dry run failed: ${revertReason}` : `Dry run failed: ${formatted}`)
    this.name = "TxDryRunError"
    this.raw = raw
    this.formatted = formatted
    this.revertReason = revertReason
  }
}

export function formatDispatchError(result: { ok: boolean; dispatchError?: unknown }): string {
  if (result.ok) return ""
  try {
    const err = result.dispatchError as { type?: string; value?: unknown } | undefined
    if (!err) return "unknown error"
    if (err.type === "Module" && err.value && typeof err.value === "object") {
      const palletErr = err.value as { type?: string; value?: unknown }
      const palletName = palletErr.type ?? "Unknown"
      if (palletErr.value && typeof palletErr.value === "object") {
        const innerErr = palletErr.value as { type?: string }
        if (innerErr.type) return `${palletName}.${innerErr.type}`
      }
      return palletName
    }
    return err.type ?? "unknown error"
  } catch {
    return "unknown error"
  }
}

function extractErrorFromValue(value: unknown): string | undefined {
  if (value == null || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.revertReason === "string" && v.revertReason) return v.revertReason
  if (typeof v.type === "string") {
    if (v.type === "Module") {
      const asDispatch = formatDispatchError({ ok: false, dispatchError: value })
      if (asDispatch !== "unknown error") return asDispatch
    }
    if (v.type === "Message" && typeof v.value === "string") return v.value
    if (v.type === "Data") {
      const inner = v.value as { asHex?: () => string } | string | undefined
      const hex =
        inner && typeof inner === "object" && typeof inner.asHex === "function"
          ? String(inner.asHex())
          : typeof inner === "string"
          ? inner
          : undefined
      return hex ? `contract reverted with data: ${hex}` : "contract reverted"
    }
    return v.type
  }
  if ("raw" in v && v.raw != null && typeof v.raw === "object") {
    return extractErrorFromValue(v.raw)
  }
  return undefined
}

export function formatDryRunError(result: {
  success: boolean
  value?: unknown
  error?: unknown
}): string {
  if (result.success) return ""
  const formatted = extractErrorFromValue(result.value)
  if (formatted) return formatted
  if (result.error != null && typeof result.error === "object") {
    const err = result.error as { type?: string; name?: string }
    if (typeof err.type === "string") return err.type
    if (typeof err.name === "string") return err.name
  }
  return "unknown error"
}

function extractRevertReason(value: unknown): string | undefined {
  if (value == null || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.revertReason === "string" && v.revertReason) return v.revertReason
  if ("raw" in v && v.raw != null && typeof v.raw === "object") {
    return extractRevertReason(v.raw)
  }
  return undefined
}

export function isSigningRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes("cancelled") ||
    msg.includes("rejected") ||
    msg.includes("denied") ||
    msg.includes("user refused")
  )
}

/**
 * Validate an Ink SDK dry-run result and extract the submittable transaction.
 * Throws TxDryRunError if the dry run failed or the result has no send().
 */
export function extractTransaction(result: {
  success: boolean
  value?: unknown
  error?: unknown
}): SubmittableTransaction {
  if (!result.success) {
    const formatted = formatDryRunError(result)
    const revertReason = extractRevertReason(result.value)
    throw new TxDryRunError(result, formatted, revertReason)
  }
  const value = result.value
  if (value == null || typeof value !== "object") {
    throw new TxDryRunError(result, "dry run returned no value")
  }
  const v = value as { send?: () => SubmittableTransaction }
  if (typeof v.send !== "function") {
    throw new TxDryRunError(result, "not a write query (no send())")
  }
  return v.send()
}

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MORTALITY_PERIOD = 256

async function resolveTransaction(tx: SubmittableTransaction): Promise<SubmittableTransaction> {
  if (tx.waited && typeof tx.waited.then === "function") return tx.waited
  return tx
}

function buildTxResult(event: Extract<TxEvent, { type: "txBestBlocksState" | "finalized" }>): TxResult {
  return {
    txHash: event.txHash,
    ok: (event as { ok?: boolean }).ok ?? false,
    block: (event as { block: { hash: string; number: number; index: number } }).block,
    events: (event as { events?: unknown[] }).events ?? [],
    dispatchError: "dispatchError" in event ? event.dispatchError : undefined,
  }
}

/**
 * Submit a transaction and watch its lifecycle through signing, broadcasting,
 * inclusion in a block, and (optionally) finalization.
 */
export async function submitAndWatch(
  tx: SubmittableTransaction,
  signer: PolkadotSigner,
  options?: SubmitOptions
): Promise<TxResult> {
  const waitFor = options?.waitFor ?? "best-block"
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const mortalityPeriod = options?.mortalityPeriod ?? DEFAULT_MORTALITY_PERIOD
  const onStatus = options?.onStatus

  const resolvedTx = await resolveTransaction(tx)

  return new Promise((resolve, reject) => {
    let settled = false
    let subscription: { unsubscribe: () => void } | null = null

    const timer = setTimeout(() => {
      subscription?.unsubscribe()
      if (!settled) {
        settled = true
        onStatus?.("error")
        reject(new TxTimeoutError(timeoutMs))
      }
    }, timeoutMs)

    function teardown() {
      clearTimeout(timer)
      subscription?.unsubscribe()
    }

    function settleReject(error: Error) {
      if (settled) return
      settled = true
      teardown()
      onStatus?.("error")
      reject(error)
    }

    try {
      const observable = resolvedTx.signSubmitAndWatch(signer, {
        mortality: { mortal: true, period: mortalityPeriod },
      })

      subscription = observable.subscribe({
        next: (event) => {
          switch (event.type) {
            case "signed":
              onStatus?.("signing")
              break
            case "broadcasted":
              onStatus?.("broadcasting")
              break
            case "txBestBlocksState": {
              if (!event.found) break
              if (event.ok === false) {
                const formatted = formatDispatchError({ ok: false, dispatchError: event.dispatchError })
                settleReject(new TxDispatchError(event.dispatchError, formatted))
                return
              }
              onStatus?.("in-block")
              if (waitFor === "best-block" && event.ok === true && event.block && event.events) {
                settled = true
                clearTimeout(timer)
                resolve(buildTxResult(event))
              }
              break
            }
            case "finalized": {
              if (!event.ok) {
                const formatted = formatDispatchError({ ok: false, dispatchError: event.dispatchError })
                if (settled) {
                  console.warn(
                    "[tx] Transaction failed after best-block (reorg). Consumer received a stale success result.",
                    { formatted, block: event.block }
                  )
                  captureError(
                    new Error(`reorg invalidated settled tx: ${formatted}`),
                    { component: "tx", phase: "reorg-after-best-block" },
                    { block: event.block }
                  )
                } else {
                  settleReject(new TxDispatchError(event.dispatchError, formatted))
                }
                subscription?.unsubscribe()
                return
              }
              onStatus?.("finalized")
              if (!settled) {
                settled = true
                teardown()
                resolve(buildTxResult(event))
              } else {
                subscription?.unsubscribe()
              }
              break
            }
          }
        },
        error: (err) => {
          if (isSigningRejection(err)) settleReject(new TxSigningRejectedError())
          else settleReject(err)
        },
      })
    } catch (err) {
      teardown()
      if (isSigningRejection(err)) settleReject(new TxSigningRejectedError())
      else settleReject(err as Error)
    }
  })
}
