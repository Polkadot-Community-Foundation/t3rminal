"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Plus,
  Minus,
  ChevronDown,
  ChevronUp,
  ShoppingCart,
} from "lucide-react"
import { BottomNav } from "@/components/bottom-nav"
import { loadCatalog, onCatalogChange } from "@/lib/items/catalog"
import type { Catalog, CatalogItem } from "@/lib/items/types"
import { savePendingSale } from "@/lib/items/pending-sale"
import { journeyTracker } from "@/lib/telemetry"
import { useCart } from "@/lib/hooks/use-cart"
import { formatAmountFromPlanck } from "@/lib/utils/format"
import { useAssetSymbol } from "@/lib/utils/asset-metadata"

export default function ItemsPage() {
  const router = useRouter()
  const cart = useCart()

  const [catalog, setCatalog] = useState<Catalog>({ categories: [], items: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [cartExpanded, setCartExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const cat = await loadCatalog()
      setCatalog(cat)
      // If active category was deleted, fall back to first one
      if (activeCategoryId && !cat.categories.find((c) => c.id === activeCategoryId)) {
        setActiveCategoryId(cat.categories[0]?.id ?? null)
      } else if (!activeCategoryId && cat.categories.length > 0) {
        setActiveCategoryId(cat.categories[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalog")
    } finally {
      setIsLoading(false)
    }
  }, [activeCategoryId])

  useEffect(() => {
    refresh()
    return onCatalogChange(refresh)
  }, [refresh])

  const visibleItems = useMemo(() => {
    if (!activeCategoryId) return []
    return catalog.items.filter((i) => i.categoryId === activeCategoryId)
  }, [catalog.items, activeCategoryId])

  const handleCharge = () => {
    if (cart.isEmpty) return
    // Items-checkout journey covers: tap Charge → cart persisted → terminal
    // route mounted. The terminal-payment journey takes over from there.
    journeyTracker.start("items-checkout", {
      "journey.line_count": cart.lines.length,
      "journey.total_planks": cart.totalPlanks.toString(),
    })
    // Stash the cart so the terminal can render itemized rows on the receipt.
    savePendingSale(cart.lines, cart.totalPlanks)
    journeyTracker.milestone("items-checkout", "cart-persisted")
    router.push(`/terminal?amount=${cart.totalPlanks.toString()}&source=items`)
    journeyTracker.complete("items-checkout")
  }

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full pb-56">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4">
          <span className="w-10" />
          <span className="text-white font-medium">Items</span>
          <span className="w-10" />
        </header>

        {error && (
          <div className="mx-6 mb-2 bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Category chips */}
        {catalog.categories.length > 0 && (
          <div className="px-6 py-3 overflow-x-auto">
            <div className="flex gap-2.5">
              {catalog.categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategoryId(cat.id)}
                  className={`px-6 py-3 rounded-full text-base font-medium whitespace-nowrap transition ${
                    activeCategoryId === cat.id
                      ? "bg-white text-black"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Items grid */}
        <main className="flex-1 min-h-0 px-6 py-4 overflow-y-auto">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-neutral-900 rounded-2xl h-24 animate-pulse" />
              ))}
            </div>
          ) : catalog.categories.length === 0 ? (
            <EmptyState />
          ) : visibleItems.length === 0 ? (
            <div className="text-neutral-500 text-sm text-center py-12">
              No items in this category.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {visibleItems.map((item) => (
                <ItemCard key={item.id} item={item} onTap={() => cart.addItem(item)} />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Bottom dock: cart sheet + nav */}
      <div className="fixed bottom-0 inset-x-0 max-w-md mx-auto">
        <CartSheet
          lines={cart.lines}
          totalPlanks={cart.totalPlanks}
          itemCount={cart.itemCount}
          expanded={cartExpanded}
          onToggle={() => cart.isEmpty ? null : setCartExpanded((v) => !v)}
          onIncrement={(id) => {
            const item = catalog.items.find((i) => i.id === id)
            if (item) cart.addItem(item)
          }}
          onDecrement={cart.decrement}
          onRemove={cart.removeItem}
          onCharge={handleCharge}
        />
        <BottomNav />
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <ShoppingCart className="w-12 h-12 text-neutral-700 mb-4" />
      <h2 className="text-white text-lg font-medium mb-1">No items yet</h2>
      <p className="text-neutral-500 text-sm mb-6 max-w-xs">
        Scan the W3sPay admin QR to load this terminal&apos;s item catalog.
      </p>
      <Link
        href="/settings/admin-config"
        className="bg-white hover:bg-neutral-100 text-black font-medium px-6 py-3 rounded-xl text-sm"
      >
        Go to Admin Configuration
      </Link>
    </div>
  )
}

function ItemCard({ item, onTap }: { item: CatalogItem; onTap: () => void }) {
  const symbol = useAssetSymbol()
  return (
    <button
      onClick={onTap}
      className="bg-neutral-900 hover:bg-neutral-800 rounded-2xl p-4 text-left transition active:scale-95"
    >
      <div className="text-white text-sm font-medium truncate mb-1">{item.name}</div>
      <div className="text-neutral-400 text-xs">
        {formatAmountFromPlanck(item.pricePlanks)} {symbol}
      </div>
    </button>
  )
}

interface CartSheetProps {
  lines: import("@/lib/items/types").CartLine[]
  totalPlanks: bigint
  itemCount: number
  expanded: boolean
  onToggle: () => void
  onIncrement: (itemId: string) => void
  onDecrement: (itemId: string) => void
  onRemove: (itemId: string) => void
  onCharge: () => void
}

function CartSheet({
  lines,
  totalPlanks,
  itemCount,
  expanded,
  onToggle,
  onIncrement,
  onDecrement,
  onCharge,
}: CartSheetProps) {
  const symbol = useAssetSymbol()
  const isEmpty = lines.length === 0

  return (
    <div className="bg-neutral-950 border-t border-neutral-800 shadow-2xl">
      {/* Summary row */}
      <button
        onClick={onToggle}
        disabled={isEmpty}
        className="w-full flex items-center justify-between px-6 py-3 disabled:cursor-default"
      >
        <div className="flex items-center gap-2">
          {!isEmpty &&
            (expanded ? (
              <ChevronDown className="w-4 h-4 text-neutral-400" />
            ) : (
              <ChevronUp className="w-4 h-4 text-neutral-400" />
            ))}
          <span className={`text-sm font-medium ${isEmpty ? "text-neutral-500" : "text-white"}`}>
            Cart · {itemCount} {itemCount === 1 ? "item" : "items"}
          </span>
        </div>
        <span className={`text-sm font-semibold ${isEmpty ? "text-neutral-500" : "text-white"}`}>
          {formatAmountFromPlanck(totalPlanks)} {symbol}
        </span>
      </button>

      {/* Expanded lines */}
      {!isEmpty && expanded && (
        <div className="px-6 pb-3 max-h-64 overflow-y-auto space-y-2">
          {lines.map((line) => (
            <div
              key={line.item.id}
              className="bg-neutral-900 rounded-lg p-3 flex items-center justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm truncate">{line.item.name}</div>
                <div className="text-neutral-500 text-xs">
                  {formatAmountFromPlanck(line.item.pricePlanks)} {symbol} ea
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onDecrement(line.item.id)}
                  className="w-7 h-7 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center"
                >
                  <Minus className="w-3 h-3 text-white" />
                </button>
                <span className="text-white text-sm w-6 text-center">{line.quantity}</span>
                <button
                  onClick={() => onIncrement(line.item.id)}
                  className="w-7 h-7 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center"
                >
                  <Plus className="w-3 h-3 text-white" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charge button */}
      <div className="px-6 pb-3 pt-1">
        <button
          onClick={onCharge}
          disabled={isEmpty}
          className="w-full bg-white hover:bg-neutral-100 disabled:bg-neutral-800 disabled:text-neutral-500 text-black font-semibold py-4 rounded-xl transition"
        >
          {isEmpty
            ? "Add items to charge"
            : `Charge ${formatAmountFromPlanck(totalPlanks)} ${symbol}`}
        </button>
      </div>
    </div>
  )
}
