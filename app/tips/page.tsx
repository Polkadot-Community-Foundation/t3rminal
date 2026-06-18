"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { useAssetSymbol } from "@/lib/utils/asset-metadata";
import { formatAmountFromPlanck } from "@/lib/utils/format";
import { PUSD_DECIMALS } from "@/lib/utils/asset-ids";

export default function TipsPage() {
  return (
    <Suspense fallback={null}>
      <TipsPageInner />
    </Suspense>
  );
}

// Tip preset percentages, laid out two per row.
const TIP_PRESETS = [5, 7, 10, 0] as const;

function TipsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const symbol = useAssetSymbol();

  const subtotalParam = searchParams.get("subtotal");
  const valid = subtotalParam != null && /^\d+$/.test(subtotalParam);
  const subtotalPlanck = valid ? BigInt(subtotalParam) : 0n;

  // No subtotal in the URL → nothing to tip on; bounce back to item selection.
  useEffect(() => {
    if (!valid) router.replace("/items");
  }, [valid, router]);

  const fmt = (p: bigint) => formatAmountFromPlanck(p.toString(), PUSD_DECIMALS);

  // Picking a tip proceeds straight to payment — no confirm step.
  const pick = (pct: number) => {
    // Integer planck math: tip = subtotal × pct%. Scale by 100 / divide by 10000.
    const tipPlanck = (subtotalPlanck * BigInt(Math.round(pct * 100))) / 10000n;
    const totalPlanck = subtotalPlanck + tipPlanck;
    const params = new URLSearchParams({ amount: totalPlanck.toString(), source: "items" });
    if (tipPlanck > 0n) params.set("tip", tipPlanck.toString());
    router.push(`/terminal?${params.toString()}`);
  };

  if (!valid) {
    return (
      <div className="h-dvh bg-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-neutral-500 animate-spin" />
      </div>
    );
  }

  // No persistent selection — tapping a tip navigates away immediately, so the
  // buttons stay neutral with a brief press highlight for feedback.
  const tipBtnClass =
    "py-12 px-3 rounded-2xl text-4xl font-semibold transition border bg-neutral-900 text-neutral-300 border-neutral-800 hover:bg-neutral-800 active:bg-white active:text-black active:border-white";

  return (
    <div className="h-dvh bg-black flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4">
          <Link href="/items" className="p-2" aria-label="Back to items">
            <ArrowLeft className="w-6 h-6 text-white" />
          </Link>
          <span className="text-white font-medium">Add tip</span>
          <div className="w-10" />
        </header>

        <main className="flex-1 min-h-0 px-6 py-4 flex flex-col overflow-auto">
          {/* Bill */}
          <div className="text-center pt-2">
            <p className="text-neutral-400 text-lg">Bill</p>
            <p className="text-white text-6xl font-semibold mt-2">
              {fmt(subtotalPlanck)} <span className="text-2xl text-neutral-400">{symbol}</span>
            </p>
          </div>

          {/* Tip options — centered, two per row. Tap proceeds immediately. */}
          <div className="flex-1 flex flex-col justify-center">
            <div className="grid grid-cols-2 gap-3">
              {TIP_PRESETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => pick(value)}
                  className={tipBtnClass}
                >
                  {value}%
                </button>
              ))}
            </div>
          </div>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
