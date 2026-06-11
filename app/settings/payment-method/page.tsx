"use client";

/**
 * Payment-method selector.
 *
 * Flips the terminal between the pUSD-on-Asset-Hub flow ("Voucher") and the
 * default W3S real-time Coinage flow ("Coins"). The choice persists in host
 * storage and is read by /terminal to decide which QR + listener to arm.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { BottomNav } from "@/components/bottom-nav";
import { usePaymentMethod } from "@/lib/config/payment-method";

export default function PaymentMethodSettingsPage() {
  const { method, setMethod } = usePaymentMethod();
  const isCoins = method === "coins";
  const loading = method === undefined;

  return (
    <div className="h-dvh bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        <header className="flex items-center gap-3 px-5 py-4">
          <Link
            href="/settings"
            className="text-neutral-400 hover:text-white"
            aria-label="Back to Settings"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-semibold">Payment Method</h1>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto px-5 py-6 space-y-6">
        {/* Two-position pill switch */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-2">
          <div className="relative grid grid-cols-2">
            {/* Sliding highlight */}
            <span
              aria-hidden
              className={`absolute top-0 bottom-0 w-1/2 rounded-xl bg-white transition-transform duration-200 ease-out ${
                isCoins ? "translate-x-full" : "translate-x-0"
              }`}
            />
            <button
              type="button"
              role="switch"
              aria-checked={!isCoins}
              disabled={loading}
              onClick={() => (loading ? undefined : isCoins && setMethod("standard"))}
              className="relative z-10 py-3 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <span className={isCoins ? "text-neutral-400" : "text-black"}>
                Voucher
              </span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={isCoins}
              disabled={loading}
              onClick={() => (loading ? undefined : !isCoins && setMethod("coins"))}
              className="relative z-10 py-3 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <span className={isCoins ? "text-black" : "text-neutral-400"}>
                Coins
              </span>
            </button>
          </div>
        </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
