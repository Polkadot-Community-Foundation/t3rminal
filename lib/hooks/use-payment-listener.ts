"use client"

import { useEffect, useState, useRef } from "react"
import { getClient } from "@/lib/papi/client"
import { paseo_individuality } from "@parity/product-sdk-descriptors/paseo-individuality"
import { encodeAddress } from "@polkadot/util-crypto"
import { normalizeToAssetHubAddress } from "@/lib/utils/address"
import { isPusdAssetId, PUSD_ASSET_ID } from "@/lib/utils/asset-ids"
import { generateSaleId } from "@/lib/utils/sale-id"

export interface PaymentDetected {
  from: string
  to: string
  amount: string
  assetId: string
  blockHash: string
  blockNumber: number
  saleId: string
  chain: "paseo-individuality"
}

interface ListenerOptions {
  recipient: string
  onPaymentDetected: (payment: PaymentDetected) => void
  /**
   * Fires when a previously-detected payment's block crosses finality.
   * Optional — callers that don't care about confirmation (e.g. one-shot
   * tests) can omit it. Receives the block hash of the finalized block;
   * compare against the captured `payment.blockHash` to know whether this
   * is the sale you're watching.
   */
  onPaymentFinalized?: (blockHash: string) => void
}

function extractAddress(raw: unknown): string {
  if (typeof raw === "string") return raw
  if ((raw as { value?: string })?.value) return (raw as { value: string }).value
  if (raw instanceof Uint8Array) return encodeAddress(raw, 0)
  return String(raw)
}

/**
 * Listen for incoming pUSD payments on Paseo Individuality.
 *
 * The polkadot-app-android v2 pay-deeplink dispatches one of two Coinage
 * calls depending on whether the voucher group exactly matches the requested
 * amount:
 *
 *   • exact match → `unload_recycler_into_external_asset`
 *     emits Coinage.RecyclerUnloadedIntoExternalAsset { to, amount }
 *   • surplus     → `unload_recycler_into_external_asset_and_vouchers`
 *     emits Coinage.RecyclerUnloadedIntoExternalAssetAndVouchers
 *           { to, external_asset_amount, voucher_count, ... }
 *
 * The "and-vouchers" path was added in android PR #666 (May 28) and previously
 * broke our listener because we only watched Assets.Transferred. Now we watch
 * BOTH Coinage events directly (they carry the merchant in the `to` field)
 * AND keep Assets.Transferred as a safety net — whichever fires first wins.
 *
 * Dedup by blockHash so multiple matching events from the same offboard don't
 * trigger the success screen twice.
 */
export function usePaymentListener(options: ListenerOptions | null) {
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const callbackRef = useRef(options?.onPaymentDetected)
  callbackRef.current = options?.onPaymentDetected
  const finalizedRef = useRef(options?.onPaymentFinalized)
  finalizedRef.current = options?.onPaymentFinalized

  useEffect(() => {
    if (!options) { setIsListening(false); return }

    console.log("[PaymentListener] Starting Paseo Individuality listener")
    const cleanups: (() => void)[] = []
    const firedBlocks = new Set<string>()
    const finalizedBlocks = new Set<string>()

    const fireFinalized = (source: string, blockHash: string) => {
      if (!firedBlocks.has(blockHash)) return
      if (finalizedBlocks.has(blockHash)) return
      finalizedBlocks.add(blockHash)
      console.log(`[PaymentListener] ${source}: block ${blockHash.slice(0, 10)} FINALIZED`)
      finalizedRef.current?.(blockHash)
    }

    const startListening = async () => {
      try {
        const normalizedRecipient = normalizeToAssetHubAddress(options.recipient)
        console.log("[PaymentListener] Watching pUSD transfers to:", normalizedRecipient)

        const client = await getClient()
        const api = client.getTypedApi(paseo_individuality)

        // Capture the chain tip at subscribe time. PAPI's `watchBest()`
        // semantics: on every fresh subscription it first replays every
        // currently-pinned block (events and all), THEN starts emitting
        // genuinely new ones. Without this guard, a listener that mounts
        // right after a sale lands would re-deliver that sale's Coinage
        // event to the new subscriber → the next QR screen would jump
        // straight to "Payment completed" for the previous transaction.
        // Filtering on `block.number > startBlockNumber` drops every replay
        // emission. New blocks always have a strictly higher number.
        const bestBlocks = await client.getBestBlocks()
        const startBlockNumber = bestBlocks.length > 0
          ? Math.max(...bestBlocks.map(b => b.number))
          : 0
        console.log(`[PaymentListener] Ignoring events at or below block #${startBlockNumber} (replay guard)`)

        const fire = (
          source: string,
          amount: bigint,
          blockHash: string,
          blockNumber: number,
          fromAddr?: string,
        ) => {
          if (firedBlocks.has(blockHash)) {
            console.log(`[PaymentListener] ${source}: dup block ${blockHash.slice(0, 10)} — skip`)
            return
          }
          firedBlocks.add(blockHash)
          const saleId = generateSaleId()
          console.log(`[PaymentListener] ${source} MATCHED, saleId:`, saleId, "amount:", amount.toString())
          callbackRef.current?.({
            from: fromAddr ?? "anonymous",
            to: normalizedRecipient,
            amount: amount.toString(),
            assetId: PUSD_ASSET_ID.toString(),
            blockHash,
            blockNumber,
            saleId,
            chain: "paseo-individuality",
          })
        }

        // We watch best-block (not finalized) for ~6s detection latency vs.
        // the ~30s finality wait. Trade-off: on a reorg the chain may emit
        // `type: "drop"` for a block we already fired on — we log a warning
        // but don't roll back the UI, since reorgs of depth 1 are extremely
        // rare on Paseo and the merchant has already shown success. If this
        // ever bites in production, gate the success screen behind a
        // "finalized" event instead.

        // (1) New path — Coinage.RecyclerUnloadedIntoExternalAssetAndVouchers
        //     emitted by android PR #666's `_and_vouchers` variant.
        const subAndVouchers = api.event.Coinage.RecyclerUnloadedIntoExternalAssetAndVouchers
          .watchBest()
          .subscribe({
            next: ({ type, block, events }) => {
              if (type === "drop") {
                if (firedBlocks.has(block.hash)) {
                  console.warn(`[PaymentListener] REORG: block ${block.hash.slice(0, 10)} dropped after firing`)
                }
                return
              }
              if (type === "finalized") {
                fireFinalized("Coinage.UnloadedAndVouchers", block.hash)
                return
              }
              if (type !== "new") return
              if (block.number <= startBlockNumber) return
              for (const event of events) {
                const to = extractAddress(event.payload.to)
                const normalizedTo = normalizeToAssetHubAddress(to)
                if (normalizedTo !== normalizedRecipient) continue
                fire(
                  "Coinage.UnloadedAndVouchers",
                  event.payload.external_asset_amount,
                  block.hash,
                  block.number,
                )
              }
            },
            error: (err) => console.error("[PaymentListener] UnloadedAndVouchers error:", err),
          })
        cleanups.push(() => subAndVouchers.unsubscribe())

        // (2) Existing path — Coinage.RecyclerUnloadedIntoExternalAsset
        //     emitted by `unload_recycler_into_external_asset`. In some runtime
        //     versions the `to` field here is an intermediate, not the merchant
        //     — in that case the Assets.Transferred watcher below picks it up.
        const subUnloaded = api.event.Coinage.RecyclerUnloadedIntoExternalAsset
          .watchBest()
          .subscribe({
            next: ({ type, block, events }) => {
              if (type === "drop") {
                if (firedBlocks.has(block.hash)) {
                  console.warn(`[PaymentListener] REORG: block ${block.hash.slice(0, 10)} dropped after firing`)
                }
                return
              }
              if (type === "finalized") {
                fireFinalized("Coinage.Unloaded", block.hash)
                return
              }
              if (type !== "new") return
              if (block.number <= startBlockNumber) return
              for (const event of events) {
                const to = extractAddress(event.payload.to)
                const normalizedTo = normalizeToAssetHubAddress(to)
                if (normalizedTo !== normalizedRecipient) {
                  console.log(
                    `[PaymentListener] Coinage.Unloaded to ${normalizedTo.slice(0, 10)}… (not us, expecting ${normalizedRecipient.slice(0, 10)}…) — waiting for Assets.Transferred`,
                  )
                  continue
                }
                fire(
                  "Coinage.Unloaded",
                  event.payload.amount,
                  block.hash,
                  block.number,
                )
              }
            },
            error: (err) => console.error("[PaymentListener] Unloaded error:", err),
          })
        cleanups.push(() => subUnloaded.unsubscribe())

        // (3) Fallback — Assets.Transferred filtered by recipient + pUSD asset.
        //     Catches any chain path that surfaces the merchant credit as a
        //     plain Assets transfer (older runtimes, intermediate hops, etc).
        const subAssets = api.event.Assets.Transferred.watchBest().subscribe({
          next: ({ type, block, events }) => {
            if (type === "drop") {
              if (firedBlocks.has(block.hash)) {
                console.warn(`[PaymentListener] REORG: block ${block.hash.slice(0, 10)} dropped after firing`)
              }
              return
            }
            if (type === "finalized") {
              fireFinalized("Assets.Transferred", block.hash)
              return
            }
            if (type !== "new") return
            if (block.number <= startBlockNumber) return
            for (const event of events) {
              const payload = event.payload
              const eventToStr = extractAddress(payload.to)
              const normalizedEventTo = normalizeToAssetHubAddress(eventToStr)
              if (normalizedEventTo !== normalizedRecipient) continue
              if (!isPusdAssetId(payload.asset_id)) continue

              const eventFromStr = extractAddress(payload.from)
              fire(
                "Assets.Transferred",
                payload.amount,
                block.hash,
                block.number,
                normalizeToAssetHubAddress(eventFromStr),
              )
            }
          },
          error: (err) => console.error("[PaymentListener] Assets.Transferred error:", err),
        })
        cleanups.push(() => subAssets.unsubscribe())

        setIsListening(true)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start listener")
        setIsListening(false)
      }
    }

    startListening()
    return () => { cleanups.forEach(fn => fn()); setIsListening(false) }
  }, [options?.recipient])

  return { isListening, error }
}
