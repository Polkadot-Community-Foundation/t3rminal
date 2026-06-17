"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, FileText, CloudDownload } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";

interface BackupRow {
  href: string;
  icon: typeof FileText;
  title: string;
  description: string;
}

const BACKUP_ROWS: BackupRow[] = [
  {
    href: "/daily-reports",
    icon: FileText,
    title: "Save reports",
    description: "Open the current period, save an X report or close it with a Z report.",
  },
  {
    href: "/settings/backup/restore",
    icon: CloudDownload,
    title: "Backup",
    description: "Restore reports from chain and view your backed-up reports.",
  },
];

export default function BackupHubPage() {
  return (
    <div className="h-dvh bg-black flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4">
          <Link href="/settings" className="p-2">
            <ArrowLeft className="w-6 h-6 text-white" />
          </Link>
          <div className="flex items-center gap-2">
            <CloudDownload className="w-5 h-5 text-white" />
            <span className="text-white font-medium">Reports &amp; Backup</span>
          </div>
          <div className="w-10" />
        </header>

        <main className="flex-1 min-h-0 px-6 py-4 space-y-3 overflow-auto">
          {BACKUP_ROWS.map((row) => {
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
