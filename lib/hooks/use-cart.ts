"use client"

import { useCallback, useMemo, useState } from "react"
import type { CartLine, CatalogItem } from "@/lib/items/types"

interface UseCartReturn {
  lines: CartLine[]
  totalPlanks: bigint
  itemCount: number
  isEmpty: boolean
  addItem: (item: CatalogItem) => void
  removeItem: (itemId: string) => void
  decrement: (itemId: string) => void
  setQuantity: (itemId: string, quantity: number) => void
  clear: () => void
}

/**
 * In-memory shopping cart for the items flow. Not persisted — fresh cart on
 * page mount. Quantity changes on the same itemId merge into one line.
 */
export function useCart(): UseCartReturn {
  const [lines, setLines] = useState<CartLine[]>([])

  const addItem = useCallback((item: CatalogItem) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.item.id === item.id)
      if (idx === -1) return [...prev, { item, quantity: 1 }]
      const next = [...prev]
      next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 }
      return next
    })
  }, [])

  const decrement = useCallback((itemId: string) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.item.id === itemId)
      if (idx === -1) return prev
      const current = prev[idx]
      if (current.quantity <= 1) return prev.filter((_, i) => i !== idx)
      const next = [...prev]
      next[idx] = { ...current, quantity: current.quantity - 1 }
      return next
    })
  }, [])

  const removeItem = useCallback((itemId: string) => {
    setLines((prev) => prev.filter((l) => l.item.id !== itemId))
  }, [])

  const setQuantity = useCallback((itemId: string, quantity: number) => {
    if (quantity <= 0) {
      setLines((prev) => prev.filter((l) => l.item.id !== itemId))
      return
    }
    setLines((prev) => prev.map((l) => (l.item.id === itemId ? { ...l, quantity } : l)))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const { totalPlanks, itemCount } = useMemo(() => {
    let total = BigInt(0)
    let count = 0
    for (const line of lines) {
      total += BigInt(line.item.pricePlanks) * BigInt(line.quantity)
      count += line.quantity
    }
    return { totalPlanks: total, itemCount: count }
  }, [lines])

  return {
    lines,
    totalPlanks,
    itemCount,
    isEmpty: lines.length === 0,
    addItem,
    removeItem,
    decrement,
    setQuantity,
    clear,
  }
}
