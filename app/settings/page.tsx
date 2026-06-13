"use client";

import Link from "next/link";
import { ChevronRight, Store, Shield, Database, Settings as SettingsIcon, Wallet, Coins, CloudDownload, ScrollText, FileDown } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";

interface SettingsRow {
  href: string;
  icon: typeof Shield;
  title: string;
  description: string;
}

const SETTINGS_ROWS: SettingsRow[] = [
  {
    href: "/settings/export",
    icon: FileDown,
    title: "Export sales (CSV)",
    description: "Download your sales for a chosen date range as a CSV file.",
  },
  {
    href: "/settings/payment-method",
    icon: Coins,
    title: "Payment Method",
    description: "Switch between Voucher and Coins.",
  },
  {
    href: "/settings/wallet",
    icon: Wallet,
    title: "Wallet",
    description: "Current host-derived account and its on-chain address.",
  },
  {
    href: "/settings/admin-config",
    icon: Store,
    title: "Admin Configuration",
    description: "Merchant and catalog binding scanned from the W3sPay admin QR.",
  },
  {
    href: "/settings/encryption",
    icon: Shield,
    title: "Report Encryption",
    description: "Set the secret phrase used to encrypt and read daily reports.",
  },
  {
    href: "/settings/onchain",
    icon: Database,
    title: "On-chain indexing",
    description: "Mirror finalized report CIDs to the bulletin-index contract.",
  },
  {
    href: "/settings/backup",
    icon: CloudDownload,
    title: "Backup & Restore",
    description: "View your backed-up reports for this terminal and restore them locally.",
  },
  {
    href: "/settings/logs",
    icon: ScrollText,
    title: "Debug logs",
    description: "Capture and share this session's console output for debugging.",
  },
];

export default function SettingsPage() {
  return (
    <div className="h-dvh bg-black flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-center px-4 py-4">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-white" />
            <span className="text-white font-medium">Settings</span>
          </div>
        </header>

        <main className="flex-1 min-h-0 px-6 py-4 space-y-3 overflow-auto">
          {SETTINGS_ROWS.map((row) => {
            const Icon = row.icon;
            return (
              <Link
                key={row.href}
                href={row.href}
                className="flex items-center gap-4 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 rounded-xl p-4 transition"
              >
                <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium">{row.title}</p>
                  <p className="text-neutral-400 text-xs mt-0.5">{row.description}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-500 shrink-0" />
              </Link>
            );
          })}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
