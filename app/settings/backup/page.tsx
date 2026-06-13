"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  FileText,
  FileDown,
  Calendar,
  Clock,
  Lock,
  CloudDownload,
  Download,
  X,
} from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { isInHost } from "@/lib/host/detect";
import { useAccount } from "@/lib/web3";
import { useAdminQrPayload } from "@/lib/config/admin-qr";
import { useBulletin, type DailyReportTransaction } from "@/lib/hooks/use-bulletin";
import { getAllDailyReports, getSalesForMerchantByDate } from "@/lib/storage/database";
import type { SaleRecord } from "@/lib/storage/types";
import { normalizeToAssetHubAddress } from "@/lib/utils/address";
import {
  getMerchantTerminal,
  getAllDatesViaRevive,
  getMetadataViaRevive,
  type OnChainDayMetadata,
} from "@/lib/contracts/revive-bulletin-index";
import { restoreReportsFromChain, type RestoreResult } from "@/lib/bulletin/restore-reports";
import { captureError } from "@/lib/telemetry";

interface ReportEntry {
  date: string;
  metadata: OnChainDayMetadata;
}

export default function BackupPage() {
  const { account } = useAccount();
  const adminPayload = useAdminQrPayload();
  const { readDailyReport } = useBulletin();
  const merchantIdentity = adminPayload?.receivingAddress ?? account?.address;
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const today = todayString();
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<"today" | "last-3" | "custom">("today");
  const [exportFrom, setExportFrom] = useState(today);
  const [exportTo, setExportTo] = useState(today);
  const [exportRunning, setExportRunning] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Gate host-dependent UI until after mount so the static-export prerender
  // (always "not in host") matches the first client render — avoids hydration
  // mismatch when the app is actually running inside the Polkadot host.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const inHost = mounted && isInHost();

  const load = useCallback(async () => {
    if (!isInHost()) return;
    setIsLoading(true);
    setError(null);
    try {
      const { merchantId, terminalId } = await getMerchantTerminal();
      const dates = await getAllDatesViaRevive(merchantId, terminalId);
      const rows: ReportEntry[] = [];
      for (const date of dates) {
        try {
          const metadata = await getMetadataViaRevive(merchantId, terminalId, date);
          if (metadata.exists) rows.push({ date, metadata });
        } catch (err) {
          console.warn(`[Backup] metadata fetch failed for ${date}:`, err);
        }
      }
      rows.sort((a, b) => b.date.localeCompare(a.date));
      setEntries(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load backup";
      setError(msg);
      captureError(err, { component: "backup", phase: "load" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRestore = async () => {
    setRestoring(true);
    setError(null);
    setRestoreResult(null);
    try {
      const { merchantId, terminalId } = await getMerchantTerminal();
      const result = await restoreReportsFromChain(merchantId, terminalId);
      setRestoreResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Restore failed";
      setError(msg);
      captureError(err, { component: "backup", phase: "restore" });
    } finally {
      setRestoring(false);
    }
  };

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
          console.warn(`[Backup] export could not read report ${entry.date}:`, err);
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
      downloadExportRows(rows, `t3rminal-sales-${label}.csv`);
      setExportOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      setExportError(msg);
      captureError(err, { component: "backup", phase: "export" });
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
            <CloudDownload className="w-5 h-5 text-white" />
            <span className="text-white font-medium">Backup &amp; Restore</span>
          </div>
          <button onClick={() => void load()} disabled={isLoading} className="p-2">
            <RefreshCw className={`w-5 h-5 text-white ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </header>

        {mounted && !inHost && (
          <div className="px-6 py-2">
            <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-3 text-yellow-400 text-sm">
              Backup is only available inside Polkadot
            </div>
          </div>
        )}

        {/* Restore action */}
        <div className="px-6 py-2 space-y-2">
          <p className="text-neutral-400 text-xs">
            Your backed-up reports for this terminal. Restore re-populates your
            local report list — use it if this device lost its local data.
          </p>
          <button
            type="button"
            onClick={handleRestore}
            disabled={restoring || !inHost}
            className="w-full bg-neutral-800 hover:bg-neutral-700 text-white py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition border border-neutral-700 disabled:opacity-40"
          >
            {restoring ? (
              <><Loader2 className="w-5 h-5 animate-spin" /><span>Restoring…</span></>
            ) : (
              <><CloudDownload className="w-5 h-5" /><span>Restore backup</span></>
            )}
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={!merchantIdentity || exportRunning}
            className="w-full bg-neutral-800 hover:bg-neutral-700 text-white py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition border border-neutral-700 disabled:opacity-40"
          >
            <FileDown className="w-5 h-5" />
            <span>Export sales (CSV)</span>
          </button>
          {restoreResult && (
            <div className="bg-green-900/30 border border-green-800 rounded-lg p-3 text-green-400 text-sm">
              Restored {restoreResult.restored} of {restoreResult.total} report(s).
              {restoreResult.skipped > 0 && ` ${restoreResult.skipped} already present.`}
            </div>
          )}
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Backed-up report list */}
        <main className="flex-1 min-h-0 px-6 py-4 overflow-hidden flex flex-col">
          <h3 className="text-white font-medium mb-4">Backed-up reports ({entries.length})</h3>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-neutral-400 animate-spin mb-4" />
              <p className="text-neutral-500 text-sm">Loading…</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FileText className="w-12 h-12 text-neutral-700 mb-4" />
              <p className="text-neutral-500 text-sm">No backed-up reports for this terminal</p>
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto flex-1 pb-4">
              {entries.map((entry) => (
                <div
                  key={entry.date}
                  className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-neutral-400" />
                      <span className="text-white font-medium">{entry.date}</span>
                    </div>
                    {entry.metadata.finalized ? (
                      <span className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Finalized
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-400">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Transactions</span>
                      <span className="text-neutral-300">{entry.metadata.entryCount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Saved
                      </span>
                      <span className="text-neutral-300">
                        {entry.metadata.publishedAt
                          ? new Date(entry.metadata.publishedAt * 1000).toLocaleString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Export Range Modal */}
      {exportOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[55] p-4">
          <div className="bg-neutral-900 rounded-2xl max-w-md w-full overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <FileDown className="w-4 h-4 text-white" />
                <h3 className="text-white font-medium">Export sales (CSV)</h3>
              </div>
              <button
                onClick={() => setExportOpen(false)}
                className="p-2 hover:bg-neutral-800 rounded-lg transition"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-xs text-neutral-400">
                Exports sales for the selected dates. Saved reports are used
                where available.
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
                  <p className="text-[10px] text-neutral-600">
                    Up to 92 days per export.
                  </p>
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
                disabled={exportRunning}
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
            </div>
          </div>
        </div>
      )}

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

function saleToExportRow(s: SaleRecord): ExportRow[] {
  return explodeSaleToRows(saleToSaleLike(s));
}

function txToExportRow(tx: DailyReportTransaction): ExportRow[] {
  return explodeSaleToRows(txToSaleLike(tx));
}

function escCsv(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadExportRows(rows: ExportRow[], filename: string): void {
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
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
