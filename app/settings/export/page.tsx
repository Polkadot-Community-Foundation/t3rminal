"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, FileDown, Loader2, Download } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { useAccount } from "@/lib/web3";
import { useAdminQrPayload } from "@/lib/config/admin-qr";
import { useBulletin, type DailyReportTransaction } from "@/lib/hooks/use-bulletin";
import { getAllDailyReports, getSalesForMerchantByDate } from "@/lib/storage/database";
import type { SaleRecord } from "@/lib/storage/types";
import { normalizeToAssetHubAddress } from "@/lib/utils/address";
import { captureError } from "@/lib/telemetry";
import { saveFile } from "@/lib/utils/save-file";

export default function ExportPage() {
  const { account } = useAccount();
  const adminPayload = useAdminQrPayload();
  const { readDailyReport } = useBulletin();
  const merchantIdentity = adminPayload?.receivingAddress ?? account?.address;
  const today = todayString();
  const [exportRange, setExportRange] = useState<"today" | "last-3" | "custom">("today");
  const [exportFrom, setExportFrom] = useState(today);
  const [exportTo, setExportTo] = useState(today);
  const [exportRunning, setExportRunning] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Gate host-dependent UI until after mount so the static-export prerender
  // matches the first client render — avoids hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const computeExportDates = (): string[] => {
    if (exportRange === "today") return [todayString()];
    if (exportRange === "last-3") {
      return [2, 1, 0].map((daysAgo) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        return formatYmd(d);
      });
    }
    return enumerateDateRange(exportFrom, exportTo);
  };

  const fetchDayRows = async (date: string): Promise<ExportRow[]> => {
    if (!merchantIdentity) throw new Error("Merchant account is not available");
    const storedReports = await getAllDailyReports();
    const reportsForDay = storedReports
      .filter((entry) => entry.date === date || entry.date.startsWith(`${date}#`))
      .sort((a, b) => a.date.localeCompare(b.date));

    const salesByKey = new Map<string, SaleLike>();
    if (reportsForDay.length > 0) {
      for (const entry of reportsForDay) {
        try {
          const report = await readDailyReport(entry.cid);
          for (const tx of report.transactions) {
            const sale = txToSaleLike(tx);
            salesByKey.set(exportSaleKey(sale), sale);
          }
        } catch (err) {
          console.warn(`[Export] could not read report ${entry.date}:`, err);
        }
      }
    }

    const merchant = normalizeToAssetHubAddress(merchantIdentity);
    const dayStart = new Date(date + "T00:00:00");
    const dayEnd = new Date(date + "T23:59:59.999");
    const sales = await getSalesForMerchantByDate(merchant, dayStart, dayEnd);
    for (const localSale of sales.map(saleToSaleLike)) {
      const key = exportSaleKey(localSale);
      if (!salesByKey.has(key)) salesByKey.set(key, localSale);
    }

    return [...salesByKey.values()]
      .sort((a, b) => Number(a.timestampMs) - Number(b.timestampMs))
      .flatMap(explodeSaleToRows);
  };

  const handleRunExport = async () => {
    setExportRunning(true);
    setExportError(null);
    try {
      const dates = computeExportDates();
      if (dates.length === 0) throw new Error("Choose a valid date range");
      if (dates.length > 92) throw new Error("Choose 92 days or fewer");

      const rows: ExportRow[] = [];
      for (const date of dates) {
        rows.push(...await fetchDayRows(date));
      }
      if (rows.length === 0) throw new Error("No sales found for the selected dates");

      const label = dates.length === 1 ? dates[0] : `${dates[0]}_${dates.at(-1)}`;
      await downloadExportRows(rows, `t3rminal-sales-${label}.csv`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      setExportError(msg);
      captureError(err, { component: "export", phase: "export" });
    } finally {
      setExportRunning(false);
    }
  };

  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4">
          <Link href="/settings" className="p-2">
            <ArrowLeft className="w-6 h-6 text-white" />
          </Link>
          <div className="flex items-center gap-2">
            <FileDown className="w-5 h-5 text-white" />
            <span className="text-white font-medium">Export sales (CSV)</span>
          </div>
          <div className="w-10" />
        </header>

        {mounted && !merchantIdentity && (
          <div className="px-6 py-2">
            <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-3 text-yellow-400 text-sm">
              Export is unavailable until a merchant account is configured.
            </div>
          </div>
        )}

        <main className="flex-1 min-h-0 px-6 py-4 space-y-4 overflow-auto">
          <p className="text-xs text-neutral-400">
            Exports sales for the selected dates as a CSV file. Saved reports are
            used where available, falling back to local sales.
          </p>

          <div className="grid grid-cols-3 gap-2">
            {(["today", "last-3", "custom"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setExportRange(opt)}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                  exportRange === opt
                    ? "bg-white text-black"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {opt === "today" ? "Today" : opt === "last-3" ? "Last 3 days" : "Custom"}
              </button>
            ))}
          </div>

          {exportRange === "custom" && (
            <div className="space-y-2">
              <label className="block text-xs text-neutral-500">
                From
                <input
                  type="date"
                  value={exportFrom}
                  max={exportTo}
                  onChange={(e) => setExportFrom(e.target.value)}
                  className="w-full mt-1 bg-neutral-800 text-white rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-neutral-600"
                />
              </label>
              <label className="block text-xs text-neutral-500">
                To
                <input
                  type="date"
                  value={exportTo}
                  min={exportFrom}
                  max={todayString()}
                  onChange={(e) => setExportTo(e.target.value)}
                  className="w-full mt-1 bg-neutral-800 text-white rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-neutral-600"
                />
              </label>
              <p className="text-[10px] text-neutral-600">Up to 92 days per export.</p>
            </div>
          )}

          {exportError && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-2 text-red-400 text-xs">
              {exportError}
            </div>
          )}

          <button
            type="button"
            onClick={handleRunExport}
            disabled={!merchantIdentity || exportRunning}
            className="w-full bg-white text-black py-3 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {exportRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export
              </>
            )}
          </button>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}

/* ── Export helpers ───────────────────────────────────────────── */

interface ExportRow {
  saleId: string;
  timestampMs: string;
  timestampIso: string;
  status: string;
  itemName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  asset: string;
  merchant: string;
  customer: string;
  txHash: string;
  blockNumber: string;
}

interface SaleLike {
  saleId: string;
  status: string;
  saleTotal: string;
  asset: string;
  merchant: string;
  customer: string;
  txHash: string;
  blockNumber: string;
  timestampMs: string;
  timestampIso: string;
  items?: ReadonlyArray<{ name: string; quantity: number; unitPrice: string }>;
}

function saleToSaleLike(s: SaleRecord): SaleLike {
  return {
    saleId: s.saleId,
    status: "Finished",
    saleTotal: s.amount,
    asset: s.asset,
    merchant: s.merchantAddressNormalized ?? s.merchantAddress,
    customer: s.customerAddressNormalized ?? s.customerAddress,
    txHash: s.transactionHash ?? "",
    blockNumber: s.blockNumber?.toString() ?? "0",
    timestampMs: new Date(s.timestamp).getTime().toString(),
    timestampIso: new Date(s.timestamp).toISOString(),
    items: s.items,
  };
}

function txToSaleLike(tx: DailyReportTransaction): SaleLike {
  return {
    saleId: tx.saleId,
    status: tx.status,
    saleTotal: tx.amountFormatted,
    asset: tx.asset,
    merchant: tx.originalMerchant || tx.evmMerchant,
    customer: tx.originalCustomer || tx.evmCustomer,
    txHash: tx.txHash,
    blockNumber: tx.blockNumber,
    timestampMs: tx.timestamp,
    timestampIso: tx.timestampFormatted,
    items: tx.items,
  };
}

function lineTotalOf(unitPrice: string, quantity: number): string {
  const n = Number(unitPrice);
  if (!Number.isFinite(n)) return "";
  return (n * quantity).toFixed(2);
}

function money2(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : amount;
}

function explodeSaleToRows(sale: SaleLike): ExportRow[] {
  const baseShared = {
    saleId: sale.saleId,
    timestampMs: sale.timestampMs,
    timestampIso: sale.timestampIso,
    status: sale.status,
    asset: sale.asset,
    merchant: sale.merchant,
    customer: sale.customer,
    txHash: sale.txHash,
    blockNumber: sale.blockNumber,
  };

  if (!sale.items || sale.items.length === 0) {
    return [{
      ...baseShared,
      itemName: "(amount only)",
      quantity: "1",
      unitPrice: money2(sale.saleTotal),
      lineTotal: money2(sale.saleTotal),
    }];
  }

  return sale.items.map((item) => ({
    ...baseShared,
    itemName: item.name,
    quantity: item.quantity.toString(),
    unitPrice: money2(item.unitPrice),
    lineTotal: lineTotalOf(item.unitPrice, item.quantity),
  }));
}

function exportSaleKey(sale: SaleLike): string {
  return sale.saleId || sale.txHash || `${sale.timestampMs}:${sale.saleTotal}`;
}

function escCsv(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function downloadExportRows(rows: ExportRow[], filename: string): Promise<void> {
  const headers = [
    "Sale ID",
    "Timestamp",
    "Timestamp Formatted",
    "Status",
    "Item",
    "Quantity",
    "Unit Price",
    "Line Total",
    "Asset",
    "Merchant",
    "Customer",
    "Tx Hash",
    "Block Number",
  ];
  const csvRows = rows.map((r) =>
    [
      r.saleId,
      r.timestampMs,
      r.timestampIso,
      r.status,
      r.itemName,
      r.quantity,
      r.unitPrice,
      r.lineTotal,
      r.asset,
      r.merchant,
      r.customer,
      r.txHash,
      r.blockNumber,
    ].map(escCsv).join(","),
  );
  const csv = [headers.join(","), ...csvRows].join("\n");
  await saveFile(filename, new Blob([csv], { type: "text/csv" }));
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayString(): string {
  return formatYmd(new Date());
}

function enumerateDateRange(fromYmd: string, toYmd: string): string[] {
  const from = new Date(fromYmd + "T00:00:00");
  const to = new Date(toYmd + "T00:00:00");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return [];
  }
  const out: string[] = [];
  const cur = new Date(from);
  while (cur <= to) {
    out.push(formatYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
