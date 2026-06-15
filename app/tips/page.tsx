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

  const options: { mode: TipMode; label: string }[] = [
    { mode: "5", label: "5%" },
    { mode: "10", label: "10%" },
    { mode: "custom", label: "Custom" },
  ];

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

        <main className="flex-1 min-h-0 px-6 py-4 space-y-6 overflow-auto">
          {/* Bill */}
          <div className="text-center">
            <p className="text-neutral-400 text-sm">Bill</p>
            <p className="text-white text-4xl font-semibold mt-1">
              {fmt(subtotalPlanck)} <span className="text-lg text-neutral-400">{symbol}</span>
            </p>
          </div>

          {/* Tip options */}
          <div className="grid grid-cols-3 gap-2">
            {options.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                onClick={() => setMode(opt.mode)}
                className={`py-3 px-3 rounded-xl text-sm font-medium transition border ${
                  mode === opt.mode
                    ? "bg-white text-black border-white"
                    : "bg-neutral-900 text-neutral-300 border-neutral-800 hover:bg-neutral-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {mode === "custom" && (
            <label className="block">
              <span className="text-xs text-neutral-500">Tip percentage</span>
              <div className="relative mt-1">
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
                  className="w-full bg-neutral-800 text-white rounded-xl p-3 pr-8 text-lg outline-none focus:ring-2 focus:ring-neutral-600"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400">%</span>
              </div>
            </label>
          )}

          {/* Breakdown */}
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
        </main>

        <div className="px-6 pb-4">
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
