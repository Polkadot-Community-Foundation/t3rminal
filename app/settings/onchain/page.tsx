"use client";

/**
 * On-chain indexing toggle.
 *
 * The "off" side sends daily reports to the bulletin gateway and keeps
 * the resulting CID strictly in local storage. The "on" side mirrors that
 * CID to the T3rminalBulletinIndex contract on Asset Hub so the merchant's
 * record is independently verifiable on-chain.
 */

import Link from "next/link";
import { ArrowLeft, Database, FileLock2 } from "lucide-react";

import { useOnchainIndexing } from "@/lib/config/onchain-indexing";

export default function OnchainSettingsPage() {
  const { enabled, setEnabled } = useOnchainIndexing();
  const isOn = enabled === true;

  const handleToggle = () => {
    if (enabled === undefined) return;
    void setEnabled(!enabled);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-neutral-800">
        <Link
          href="/settings"
          className="text-neutral-400 hover:text-white"
          aria-label="Back to Settings"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-semibold">On-chain indexing</h1>
      </header>

      <main className="max-w-md mx-auto px-5 py-6 space-y-6">
        <p className="text-sm text-neutral-400">
          Choose where finalized daily reports are recorded. The bulletin
          upload happens either way — the toggle only controls whether the
          resulting CID is also pinned on-chain.
        </p>

        {/* Two-position pill switch */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-2">
          <div className="relative grid grid-cols-2">
            {/* Sliding highlight */}
            <span
              aria-hidden
              className={`absolute top-0 bottom-0 w-1/2 rounded-xl bg-white transition-transform duration-200 ease-out ${
                isOn ? "translate-x-full" : "translate-x-0"
              }`}
            />
            <button
              type="button"
              role="switch"
              aria-checked={!isOn}
              disabled={enabled === undefined}
              onClick={() => enabled === undefined ? undefined : enabled && setEnabled(false)}
              className="relative z-10 py-3 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <span className={isOn ? "text-neutral-400" : "text-black"}>
                Local only
              </span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={isOn}
              disabled={enabled === undefined}
              onClick={() => enabled === undefined ? undefined : !enabled && setEnabled(true)}
              className="relative z-10 py-3 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <span className={isOn ? "text-black" : "text-neutral-400"}>
                Local + on-chain
              </span>
            </button>
          </div>
        </div>

        {/* Description card matching active position */}
        <button
          type="button"
          onClick={handleToggle}
          disabled={enabled === undefined}
          className="w-full text-left bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 rounded-2xl p-4 transition disabled:opacity-50"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 shrink-0 rounded-lg bg-neutral-800 flex items-center justify-center">
              {isOn ? (
                <Database className="w-5 h-5 text-white" />
              ) : (
                <FileLock2 className="w-5 h-5 text-white" />
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-white font-medium">
                {isOn ? "Local + on-chain" : "Local only"}
              </p>
              <p className="text-xs text-neutral-400 leading-relaxed">
                {isOn
                  ? "On finalize: upload report to Bulletin, then write the CID to the T3rminalBulletinIndex contract on Asset Hub. Each finalize costs one signed transaction; the merchant account must have statement-slot allowance."
                  : "On finalize: upload report to Bulletin and stash the CID in this device's local storage only. No on-chain write, no signing prompt, but the report can't be cross-checked from chain state alone."}
              </p>
              <p className="text-[10px] text-neutral-600 pt-1">
                Tap anywhere on this card to switch.
              </p>
            </div>
          </div>
        </button>
      </main>
    </div>
  );
}
