"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  FileText,
  ExternalLink,
  Calendar,
  Clock,
  X,
  Download,
  FileDown,
  Save,
  Lock,
} from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import {
  getAllDailyReports,
  getDailyReportByDate,
  getSalesForMerchantByDate,
} from "@/lib/storage/database";
import { normalizeToAssetHubAddress } from "@/lib/utils/address";
import type { SaleRecord } from "@/lib/storage/types";
import { onStorageChange } from "@/lib/storage/host-storage";
import { useBulletin, type DailyReport, type DailyReportTransaction } from "@/lib/hooks/use-bulletin";
import { useDailyReport } from "@/lib/hooks/use-daily-report";
import { useReceiptGenerator } from "@/lib/hooks/use-receipt-generator";
import { useAccount } from "@/lib/web3";
import { useAdminQrPayload } from "@/lib/config/admin-qr";
import { useAssetSymbol } from "@/lib/utils/asset-metadata";
import type { DailyReportRecord } from "@/lib/storage/types";

export default function DailyReportsPage() {
  const symbol = useAssetSymbol();
  const { readDailyReport } = useBulletin();
  const { generateSvgReceipt } = useReceiptGenerator();
  const { saveDailyReport, finalizeDailyReport, isFinalizing, phaseLabel, error: reportActionError } = useDailyReport();
  const { account } = useAccount();
  const adminPayload = useAdminQrPayload();
  // Match `useSalesHistory` — admin-configured payout address wins so the
  // export pulls sales saved by the terminal under that identity.
  const merchantIdentity = adminPayload?.receivingAddress ?? account?.address;

  // Which day a per-row finalize is currently running for (null = none / today).
  const [finalizingDate, setFinalizingDate] = useState<string | null>(null);
  // Date pending finalize confirmation (drives the confirm modal).
  const [confirmFinalizeDate, setConfirmFinalizeDate] = useState<string | null>(null);

  // Build (update) or finalize (lock) a day's report. Finalize is confirmed via
  // the modal before this runs, since the contract locks the slot permanently.
  const runDayAction = async (date: string, finalize: boolean) => {
    if (!merchantIdentity) return;
    setFinalizingDate(date);
    try {
      const merchant = normalizeToAssetHubAddress(merchantIdentity);
      if (finalize) {
        await finalizeDailyReport(date, merchant);
      } else {
        await saveDailyReport(date, merchant);
      }
    } catch (err) {
      console.error(`[DailyReports] ${finalize ? "finalize" : "update"} ${date} failed:`, err);
    } finally {
      setFinalizingDate(null);
    }
  };

  const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedCid, setSelectedCid] = useState<string | null>(null);

  // Receipt modal state
  const [selectedTransaction, setSelectedTransaction] = useState<DailyReportTransaction | null>(null);
  const [svgReceipt, setSvgReceipt] = useState<string | null>(null);
  const [isGeneratingReceipt, setIsGeneratingReceipt] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Load reports from host storage - auto-updates on changes
  const [reports, setReports] = useState<DailyReportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = () => getAllDailyReports().then((r) => { setReports(r); setIsLoading(false); });
    load();
    return onStorageChange("dailyReports", load);
  }, []);

  // View report from IPFS
  const handleViewReport = async (entry: DailyReportRecord) => {
    setLoadingReport(true);
    setReportError(null);
    setSelectedDate(entry.date);
    setSelectedCid(entry.cid);
    setSelectedReport(null);

    try {
      const report = await readDailyReport(entry.cid);
      setSelectedReport(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load report";
      setReportError(message);
    } finally {
      setLoadingReport(false);
    }
  };

  const closeReportModal = () => {
    setSelectedReport(null);
    setSelectedDate(null);
    setSelectedCid(null);
    setReportError(null);
  };

  // Generate receipt for a transaction from the report
  const handleGenerateReceipt = async (tx: DailyReportTransaction) => {
    setIsGeneratingReceipt(true);
    setSelectedTransaction(tx);
    try {
      const svg = await generateSvgReceipt({
        amount: tx.amountFormatted,
        asset: tx.asset,
        assetId: "native",
        merchantAddress: tx.originalMerchant || tx.evmMerchant,
        customerAddress: tx.originalCustomer || tx.evmCustomer,
        transactionId: tx.txHash,
        blockNumber: parseInt(tx.blockNumber),
        saleId: tx.saleId,
        items: tx.items,
      });
      setSvgReceipt(svg);
    } catch (err) {
      console.error("Failed to generate receipt:", err);
    } finally {
      setIsGeneratingReceipt(false);
    }
  };

  const closeReceiptModal = () => {
    setSelectedTransaction(null);
    setSvgReceipt(null);
  };

  // Download report as JSON file
  const handleDownloadReport = () => {
    if (!selectedReport || !selectedDate) return;
    const jsonString = JSON.stringify(selectedReport, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-report-${selectedDate}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── Export range modal state ──────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState<"today" | "last-3" | "custom">("today");
  const [exportFrom, setExportFrom] = useState(todayString());
  const [exportTo, setExportTo] = useState(todayString());
  const [exportRunning, setExportRunning] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * Build a list of YYYY-MM-DD strings for the selected range. Today is
   * always the last entry — we walk backwards so the iteration order
   * matches what the merchant reads on receipts (most recent first).
   */
  const computeExportDates = (): string[] => {
    if (exportRange === "today") return [todayString()];
    if (exportRange === "last-3") {
      const today = new Date();
      return Array.from({ length: 3 }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        return formatYmd(d);
      }).reverse();
    }
    // custom — inclusive range, capped to a sane upper bound so we don't
    // accidentally fetch a year of bulletin data on a single click.
    return enumerateDateRange(exportFrom, exportTo).slice(0, 92);
  };

  /**
   * Pull one day's transactions. Today is the only date that lives in
   * `localStorage` as raw `SaleRecord`s — every other day is read from
   * Bulletin via the CID we stashed when finalize() ran. If a past day
   * was never finalized we fall back to whatever sales we still have
   * locally (some may still be in IndexedDB if the merchant hasn't
   * cleared them).
   */
  const fetchDayRows = async (date: string, merchant: string): Promise<ExportRow[]> => {
    const today = todayString();
    if (date === today) {
      const dayStart = new Date(date + "T00:00:00");
      const dayEnd = new Date(date + "T23:59:59.999");
      const sales = await getSalesForMerchantByDate(merchant, dayStart, dayEnd);
      return sales.flatMap(saleToExportRow);
    }
    // Past day: prefer finalized → bulletin; fall back to local if absent.
    const finalized = await getDailyReportByDate(date);
    if (finalized?.cid) {
      try {
        const report = await readDailyReport(finalized.cid);
        return report.transactions.flatMap(txToExportRow);
      } catch (err) {
        console.warn(`[DailyReports] Bulletin fetch failed for ${date}, falling back to local:`, err);
      }
    }
    const dayStart = new Date(date + "T00:00:00");
    const dayEnd = new Date(date + "T23:59:59.999");
    const sales = await getSalesForMerchantByDate(merchant, dayStart, dayEnd);
    return sales.flatMap(saleToExportRow);
  };

  const handleRunExport = async () => {
    if (!merchantIdentity) return;
    setExportError(null);
    setExportRunning(true);
    try {
      const merchant = normalizeToAssetHubAddress(merchantIdentity);
      const dates = computeExportDates();
      if (dates.length === 0) {
        setExportError("Empty date range — pick at least one day.");
        return;
      }
      const allRows: ExportRow[] = [];
      for (const date of dates) {
        const rows = await fetchDayRows(date, merchant);
        allRows.push(...rows);
      }
      const tag =
        exportRange === "today"
          ? `${todayString()}-unfinalized`
          : exportRange === "last-3"
            ? `last-3-days-${todayString()}`
            : `${exportFrom}_to_${exportTo}`;
      downloadExportRows(allRows, `daily-report-${tag}.csv`);
      setExportOpen(false);
    } catch (err) {
      console.error("[DailyReports] Export failed:", err);
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportRunning(false);
    }
  };

  // Download report as CSV file
  const handleDownloadCsv = () => {
    if (!selectedReport || !selectedDate) return;

    const headers = [
      "Sale ID", "Status", "Amount", "Amount Formatted", "Asset",
      "Merchant", "Customer", "Tx Hash", "Block Number",
      "Timestamp", "Timestamp Formatted", "Terminal ID", "Refund Of",
    ];

    const escCsv = (val: string | null) => {
      if (val === null) return "";
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const rows = selectedReport.transactions.map(tx => [
      tx.saleId, tx.status, tx.amount, tx.amountFormatted, tx.asset,
      tx.originalMerchant || tx.evmMerchant, tx.originalCustomer || tx.evmCustomer,
      tx.txHash, tx.blockNumber, tx.timestamp, tx.timestampFormatted,
      tx.terminalId, tx.refundOf ?? "",
    ].map(escCsv).join(","));

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-report-${selectedDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4">
          <Link href="/history" className="p-2">
            <ArrowLeft className="w-6 h-6 text-white" />
          </Link>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-white" />
            <span data-testid="reports-header" className="text-white font-medium">Daily Reports</span>
          </div>
          <div className="w-10" />
        </header>

        {/* Stats */}
        <div className="px-6 py-3">
          <div className="bg-neutral-900 rounded-lg p-4">
            <p className="text-neutral-400 text-xs mb-1">Total Reports</p>
            <p data-testid="reports-count" className="text-white text-2xl font-semibold">{reports?.length ?? 0}</p>
          </div>
        </div>

        {/* Today's report actions */}
        {(() => {
          const today = todayString();
          const todayReport = reports.find((r) => r.date === today);
          const todayFinalized = !!todayReport?.finalized;
          return (
            <div className="px-6 py-2 space-y-2">
              {todayFinalized ? (
                <div className="bg-green-900/30 border border-green-800 rounded-xl p-3 flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4 text-green-400" />
                  <span className="text-green-400 text-sm">Today is finalized</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="btn-update-report"
                    onClick={() => runDayAction(today, false)}
                    disabled={!merchantIdentity || isFinalizing}
                    className="w-full bg-neutral-800 hover:bg-neutral-700 text-white py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition border border-neutral-700 disabled:opacity-40"
                  >
                    {isFinalizing && finalizingDate === today ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /><span className="truncate">{phaseLabel || "Saving…"}</span></>
                    ) : (
                      <><Save className="w-5 h-5 shrink-0" /><span>Update</span></>
                    )}
                  </button>
                  <button
                    type="button"
                    data-testid="btn-finalize-day"
                    onClick={() => setConfirmFinalizeDate(today)}
                    disabled={!merchantIdentity || isFinalizing}
                    className="w-full bg-green-600 hover:bg-green-500 text-white py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition disabled:bg-neutral-700 disabled:text-neutral-500"
                  >
                    <Lock className="w-5 h-5 shrink-0" />
                    <span>Finalize</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                disabled={!merchantIdentity}
                className="w-full bg-neutral-800 hover:bg-neutral-700 text-white py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition border border-neutral-700 disabled:opacity-40"
              >
                <FileDown className="w-5 h-5" />
                <span>Export sales (CSV)</span>
              </button>
              {reportActionError && (
                <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
                  {reportActionError}
                </div>
              )}
            </div>
          );
        })()}

        {/* Reports List */}
        <main className="flex-1 min-h-0 px-6 py-4 overflow-hidden flex flex-col">
          <h3 className="text-white font-medium mb-4">Saved Daily Reports</h3>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-neutral-400 animate-spin mb-4" />
              <p className="text-neutral-500 text-sm">Loading reports...</p>
            </div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FileText className="w-12 h-12 text-neutral-700 mb-4" />
              <p data-testid="reports-empty" className="text-neutral-500 text-sm">No daily reports yet</p>
              <p className="text-neutral-600 text-xs mt-1">
                Use “Update report” or “Finalize day” to create one
              </p>
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto flex-1 pb-4">
              {reports.map((entry, index) => (
                <div
                  key={`${entry.date}-${index}`}
                  className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-neutral-400" />
                      <span className="text-white font-medium">{entry.date}</span>
                    </div>
                    {entry.finalized ? (
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
                      <span className="text-neutral-300">{entry.entryCount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Saved
                      </span>
                      <span className="text-neutral-300">
                        {new Date(entry.publishedAt).toLocaleString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>

                  {/* View Details Button */}
                  <button
                    data-testid={`report-view-${index}`}
                    onClick={() => handleViewReport(entry)}
                    disabled={loadingReport}
                    className="mt-4 w-full bg-neutral-800 hover:bg-neutral-700 text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>View Details</span>
                  </button>

                  {/* Finalize a past, not-yet-finalized day: re-packages that
                      day's txs and locks it. Today is finalized from the
                      buttons at the top, so it's excluded here. */}
                  {!entry.finalized && entry.date !== todayString() && (
                    <button
                      data-testid={`report-finalize-${index}`}
                      onClick={() => setConfirmFinalizeDate(entry.date)}
                      disabled={!merchantIdentity || isFinalizing}
                      className="mt-2 w-full bg-green-600 hover:bg-green-500 text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition disabled:bg-neutral-700 disabled:text-neutral-500"
                    >
                      {isFinalizing && finalizingDate === entry.date ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /><span>{phaseLabel || "Finalizing…"}</span></>
                      ) : (
                        <><Lock className="w-4 h-4" /><span>Finalize day</span></>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <BottomNav />

      {/* Finalize confirmation modal */}
      {confirmFinalizeDate && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 rounded-2xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-green-400" />
              <h3 className="text-white font-medium">Finalize day?</h3>
            </div>
            <p className="text-neutral-400 text-sm">
              This locks <span className="text-white">{confirmFinalizeDate}</span>.
              Once finalized, the day can no longer be updated or overwritten.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmFinalizeDate(null)}
                disabled={isFinalizing}
                className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-white py-3 px-4 rounded-xl transition disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="btn-finalize-confirm"
                onClick={() => {
                  const date = confirmFinalizeDate;
                  setConfirmFinalizeDate(null);
                  void runDayAction(date, true);
                }}
                disabled={isFinalizing}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition disabled:bg-neutral-700 disabled:text-neutral-500"
              >
                <Lock className="w-4 h-4" />
                <span>Finalize</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Details Modal */}
      {(selectedDate || selectedCid) && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-neutral-800">
              <h3 className="text-white font-medium">Report Details</h3>
              <button
                onClick={closeReportModal}
                className="p-2 hover:bg-neutral-800 rounded-lg transition"
              >
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>

            {/* Report Content */}
            <div className="p-4 space-y-4">
              {loadingReport ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 text-neutral-400 animate-spin mb-4" />
                  <p className="text-neutral-500 text-sm">Loading report from IPFS...</p>
                </div>
              ) : reportError ? (
                <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 text-red-400 text-sm">
                  {reportError}
                </div>
              ) : (
                <>
                  {/* Date */}
                  <div className="bg-neutral-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-400">Date</span>
                      <span className="text-white font-medium">{selectedDate}</span>
                    </div>
                  </div>

                  {/* Open / download */}
                  <div className="bg-neutral-800 rounded-lg p-4 space-y-3">
                    <h4 className="text-white font-medium text-sm">View report</h4>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDownloadReport}
                        disabled={!selectedReport}
                        className="flex-1 flex items-center justify-center gap-2 text-white bg-neutral-700 hover:bg-neutral-600 py-2 px-3 rounded-lg transition text-sm disabled:opacity-50"
                      >
                        <Download className="w-4 h-4" />
                        <span>JSON</span>
                      </button>
                      <button
                        onClick={handleDownloadCsv}
                        disabled={!selectedReport}
                        className="flex-1 flex items-center justify-center gap-2 text-white bg-neutral-700 hover:bg-neutral-600 py-2 px-3 rounded-lg transition text-sm disabled:opacity-50"
                      >
                        <Download className="w-4 h-4" />
                        <span>CSV</span>
                      </button>
                    </div>
                  </div>

                  {/* Selected Report Display */}
                  {selectedReport && (
                    <>
                      {/* Summary Stats */}
                      <div className="bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-800/50 rounded-lg p-4 space-y-3">
                        <h4 className="text-green-400 font-medium text-sm">Report Summary</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-black/30 rounded-lg p-3">
                            <p className="text-neutral-500 text-xs">Transactions</p>
                            <p className="text-white text-xl font-semibold">{selectedReport.totalTransactions}</p>
                          </div>
                          <div className="bg-black/30 rounded-lg p-3">
                            <p className="text-neutral-500 text-xs">Date</p>
                            <p className="text-white text-lg font-semibold">{selectedReport.selectedDate}</p>
                          </div>
                        </div>
                        <div className="space-y-1 text-xs pt-2 border-t border-green-800/30">
                          <div className="flex justify-between">
                            <span className="text-neutral-500">Exported</span>
                            <span className="text-neutral-300">
                              {new Date(selectedReport.exportDate).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Transactions List */}
                      <div className="bg-neutral-800 rounded-lg p-4 space-y-3">
                        <h4 className="text-white font-medium text-sm">
                          Transactions ({selectedReport.transactions.length})
                        </h4>
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                          {selectedReport.transactions.map((tx, index) => (
                            <div
                              key={tx.saleId || index}
                              className="bg-neutral-900 rounded-lg p-3 space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-white font-medium text-sm">
                                  {money2(tx.amountFormatted)} {symbol}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  tx.status === "Finished"
                                    ? "bg-green-500/20 text-green-400"
                                    : "bg-orange-500/20 text-orange-400"
                                }`}>
                                  {tx.status}
                                </span>
                              </div>
                              <div className="flex justify-between text-xs">
                                <span className="text-neutral-500">Sale</span>
                                <span className="text-neutral-400 font-mono">
                                  #{(tx.saleId ?? "").slice(-4).toUpperCase()}
                                </span>
                              </div>
                              <button
                                onClick={() => handleGenerateReceipt(tx)}
                                disabled={isGeneratingReceipt}
                                className="w-full bg-neutral-700 hover:bg-neutral-600 text-white py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition text-xs"
                              >
                                <FileText className="w-3 h-3" />
                                <span>View Record</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Close Button */}
            <div className="p-4 border-t border-neutral-800">
              <button
                onClick={closeReportModal}
                className="w-full bg-white text-black py-3 rounded-xl font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
                Today is read straight from local storage. Past days are pulled
                from Bulletin via the CID saved when you finalized the day; if a
                past day was never finalized, we fall back to whatever sales are
                still in local storage for that date.
              </p>

              {/* Range selector */}
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

              {/* Custom date inputs */}
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

      {/* Receipt Modal */}
      {selectedTransaction && svgReceipt && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
          <div className="bg-neutral-900 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-neutral-800">
              <h3 className="text-white font-medium">Transaction Record</h3>
              <button
                onClick={closeReceiptModal}
                className="p-2 hover:bg-neutral-800 rounded-lg transition"
              >
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>

            {/* Receipt SVG */}
            <div className="p-4">
              <div
                className="bg-white rounded-lg overflow-hidden"
                dangerouslySetInnerHTML={{ __html: svgReceipt }}
              />
            </div>

            {/* Transaction Details */}
            <div className="p-4 border-t border-neutral-800">
              <h4 className="text-white font-medium mb-3">Transaction Data</h4>
              <div className="space-y-2 text-xs bg-neutral-800 rounded-lg p-3">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Sale ID</span>
                  <span className="text-neutral-300 font-mono text-[10px]">{selectedTransaction.saleId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Amount</span>
                  <span className="text-neutral-300">{money2(selectedTransaction.amountFormatted)} {selectedTransaction.asset}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Status</span>
                  <span className={selectedTransaction.status === 'Finished' ? 'text-green-400' : 'text-orange-400'}>
                    {selectedTransaction.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">From</span>
                  <span className="text-neutral-300">Customer</span>
                </div>
              </div>
            </div>

            {/* Close Button */}
            <div className="p-4 border-t border-neutral-800">
              <button
                onClick={closeReceiptModal}
                className="w-full bg-white text-black py-3 rounded-xl font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Export helpers ───────────────────────────────────────────── */

/**
 * One CSV row per ITEM, not per sale. A sale with three line items emits
 * three rows; a direct-amount sale (no items) emits a single row with the
 * sale total as a synthetic line. Sale-level columns (Sale ID, timestamp,
 * merchant, etc.) repeat across all of that sale's rows so the merchant
 * can group/sum in a spreadsheet.
 */
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

/** Two-decimal product, dot-separated — matches CSV-friendly numeric form. */
function lineTotalOf(unitPrice: string, quantity: number): string {
  const n = Number(unitPrice);
  if (!Number.isFinite(n)) return "";
  return (n * quantity).toFixed(2);
}

/**
 * Normalize a stored amount string to two decimals so every numeric column
 * in the export reads consistently ("5.5" → "5.50", "6" → "6.00"). Stored
 * records predating consistent formatting flow through here too. Non-numeric
 * values pass through untouched.
 */
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
    // Direct-amount sale — surface the total as a single synthetic line so
    // the CSV stays row-per-item without losing rows for amount-only sales.
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

/* ── Date helpers ─────────────────────────────────────────────── */

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
