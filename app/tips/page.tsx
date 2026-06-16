"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
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

type TipMode = "none" | "5" | "10" | "custom";

function clampPct(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100);
}

function TipsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const symbol = useAssetSymbol();

  const subtotalParam = searchParams.get("subtotal");
  const valid = subtotalParam != null && /^\d+$/.test(subtotalParam);
  const subtotalPlanck = valid ? BigInt(subtotalParam) : 0n;

  const [mode, setMode] = useState<TipMode>("none");
  const [customPct, setCustomPct] = useState("");

  // No subtotal in the URL → nothing to tip on; bounce back to item selection.
  useEffect(() => {
    if (!valid) router.replace("/items");
  }, [valid, router]);

  const pct =
    mode === "5" ? 5 : mode === "10" ? 10 : mode === "custom" ? clampPct(customPct) : 0;

  // Integer planck math: tip = subtotal × pct%. `pct` may carry one or two
  // decimals (custom), so scale by 100 and divide by 10000.
  const tipPlanck = (subtotalPlanck * BigInt(Math.round(pct * 100))) / 10000n;
  const totalPlanck = subtotalPlanck + tipPlanck;

  const fmt = (p: bigint) => formatAmountFromPlanck(p.toString(), PUSD_DECIMALS);

  const proceed = () => {
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

  const tipBtnClass = (active: boolean) =>
    `py-8 px-3 rounded-2xl text-2xl font-semibold transition border ${
      active
        ? "bg-white text-black border-white"
        : "bg-neutral-900 text-neutral-300 border-neutral-800 hover:bg-neutral-800"
    }`;

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
            <p className="text-neutral-400 text-sm">Bill</p>
            <p className="text-white text-4xl font-semibold mt-1">
              {fmt(subtotalPlanck)} <span className="text-lg text-neutral-400">{symbol}</span>
            </p>
          </div>

          {/* Tip options — centered in the available space; 5/10 on one row,
              Custom on the next. */}
          <div className="flex-1 flex flex-col justify-center gap-3">
            {/* Presets hide once Custom is open so the input gets the room. */}
            {mode !== "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setMode("5")} className={tipBtnClass(mode === "5")}>
                  5%
                </button>
                <button type="button" onClick={() => setMode("10")} className={tipBtnClass(mode === "10")}>
                  10%
                </button>
              </div>
            )}
            {/* Tapping Custom while it's open returns to the presets. */}
            <button
              type="button"
              onClick={() => setMode(mode === "custom" ? "none" : "custom")}
              className={tipBtnClass(mode === "custom")}
            >
              Custom %
            </button>

            {mode === "custom" && (
              <label className="block">
                <span className="text-base text-neutral-400">Custom %</span>
                <div className="relative mt-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.5"
                    autoFocus
                    value={customPct}
                    onChange={(e) => setCustomPct(e.target.value)}
                    placeholder="0"
                    className="w-full bg-neutral-800 text-white rounded-2xl py-6 pl-5 pr-16 text-4xl font-semibold outline-none focus:ring-2 focus:ring-neutral-600"
                  />
                  <span className="absolute right-5 top-1/2 -translate-y-1/2 text-3xl font-semibold text-neutral-300">%</span>
                </div>
              </label>
            )}
          </div>
        </main>

        {/* Footer: price breakdown sits right above the action button */}
        <div className="px-6 pb-4 space-y-3">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">Subtotal</span>
              <span className="text-neutral-200">{fmt(subtotalPlanck)} {symbol}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">Tip{pct > 0 ? ` (${pct}%)` : ""}</span>
              <span className="text-neutral-200">{fmt(tipPlanck)} {symbol}</span>
            </div>
            <div className="flex justify-between pt-3 border-t border-neutral-800">
              <span className="text-white font-medium">Total</span>
              <span className="text-white text-xl font-semibold">{fmt(totalPlanck)} {symbol}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={proceed}
            className="w-full bg-white text-black py-4 rounded-xl font-medium flex items-center justify-center gap-2 transition hover:bg-neutral-200"
          >
            <span>Continue to payment</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
