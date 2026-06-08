/**
 * Pending sale handoff between /items and /terminal.
 *
 * When the merchant taps "Charge" on the items page we navigate to /terminal
 * with the total in the URL, but the URL alone can't carry the cart contents
 * cleanly. We stash the cart lines in sessionStorage (per tab, cleared on
 * close), the terminal page reads them when it boots, and they flow into the
 * receipt as itemized rows.
 */

"use client"

import type { CartLine } from "./types"

const STORAGE_KEY = "t3rminal:pending-sale"

interface StoredCartLine {
  name: string
  pricePlanks: string
  quantity: number
}

interface StoredSale {
  lines: StoredCartLine[]
  totalPlanks: string
  createdAt: number
}

export function savePendingSale(lines: CartLine[], totalPlanks: bigint): void {
  if (typeof window === "undefined") return
  const data: StoredSale = {
    lines: lines.map((l) => ({
      name: l.item.name,
      pricePlanks: l.item.pricePlanks,
      quantity: l.quantity,
    })),
    totalPlanks: totalPlanks.toString(),
    createdAt: Date.now(),
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (err) {
    console.warn("[PendingSale] Failed to persist cart for terminal handoff:", err)
  }
}

export function readPendingSale(): StoredSale | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSale
    if (!Array.isArray(parsed.lines)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearPendingSale(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export type { StoredCartLine, StoredSale }
