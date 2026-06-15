"use client";

import { useState, useCallback } from "react";
import { useBulletin, type DailyReport } from "./use-bulletin";
import { activeNetwork } from "@/lib/contracts/config";
import { addDailyReport, getSalesForMerchantByDate } from "@/lib/storage/database";
import type { SaleRecord } from "@/lib/storage/types";
import { isInHost } from "@/lib/host/detect";
import { getHostAccounts } from "@/lib/host/accounts";
import {
  storeDailyReportViaRevive,
  getMerchantTerminal,
} from "@/lib/contracts/revive-bulletin-index";
import { useAccount } from "@/lib/web3";
import { loadManualKey, manualKeyFingerprint } from "@/lib/crypto/manual-key";
import { encryptReportSymmetric } from "@/lib/crypto/symmetric-report";
import { journeyTracker, captureError, isExpectedError } from "@/lib/telemetry";
import { loadAdminQrPayload } from "@/lib/config/admin-qr";
import { isOnchainIndexingEnabled } from "@/lib/config/onchain-indexing";
import type { T3rminalConfigQrPayloadV2 } from "@/lib/config/t3rminal-config-qr";

export interface FinalizeDayResult {
  report: DailyReport;
  cid: string;
  gatewayUrl: string;
  bulletinBlockHash: string;
  signedBy: string;
  onChainIndexed: boolean;
  /** Whether this write locked the day on-chain (finalize) or left it open. */
  finalized: boolean;
}

export type FinalizePhase =
  | "idle"
  | "generating"
  | "encrypting"
  | "uploading"
  | "submitting-onchain"
  | "saving-local"
  | "done";

// User-facing copy stays generic per Parity Product Tenet 10 — no chain
// jargon, no "on-chain", no "sign on phone". Detailed phase information is
// still emitted to console.log for developers.
const PHASE_LABELS: Record<FinalizePhase, string> = {
  idle: "",
  generating: "Finalizing…",
  encrypting: "Finalizing…",
  uploading: "Saving…",
  "submitting-onchain": "Saving…",
  "saving-local": "Saving…",
  done: "Done",
};

export interface UseDailyReportReturn {
  isGenerating: boolean;
  isUploading: boolean;
  isFinalizing: boolean;
  phase: FinalizePhase;
  phaseLabel: string;
  error: string | null;
  generateReport: (date: string, merchantAddress: string, finalize?: boolean) => Promise<DailyReport>;
  generateReportForSales: (args: PeriodReportArgs) => Promise<DailyReport>;
  uploadReport: (report: DailyReport) => Promise<{
    cid: string;
    cidHash: string;
    gatewayUrl: string;
    blockHash: string;
  }>;
  /**
   * Build + upload a report for `date` and mirror its CID locally and on-chain,
   * leaving the day OPEN (repeatable — overwrites the prior CID).
   */
  saveDailyReport: (date: string, merchantAddress: string) => Promise<FinalizeDayResult>;
  savePeriodReport: (args: PeriodReportArgs) => Promise<FinalizeDayResult>;
  /**
   * Same pipeline as `saveDailyReport`, but LOCKS the day on-chain. After this
   * the contract rejects any further write to (merchantId, terminalId, date).
   */
  finalizeDailyReport: (date: string, merchantAddress: string) => Promise<FinalizeDayResult>;
  finalizePeriodReport: (args: PeriodReportArgs) => Promise<FinalizeDayResult>;
}

export interface PeriodReportArgs {
  date: string;
  periodKey: string;
  merchantAddress: string;
  sales: SaleRecord[];
  periodStart?: Date;
  periodLabel?: string;
}

/**
 * Get sales from host storage for a specific date and merchant
 */
async function getSalesForDate(date: string, merchantAddressNormalized: string): Promise<SaleRecord[]> {
  const dayStart = new Date(date + "T00:00:00");
  const dayEnd = new Date(date + "T23:59:59.999");
  return getSalesForMerchantByDate(merchantAddressNormalized, dayStart, dayEnd);
}

function buildDailyReportFromSales(args: {
  date: string;
  periodKey?: string;
  sales: SaleRecord[];
  merchantAddress: string;
  finalize: boolean;
  adminPayload: T3rminalConfigQrPayloadV2 | null;
  periodStart?: Date;
  periodLabel?: string;
}): DailyReport {
  const terminalId = args.adminPayload?.terminalId ?? "T3RMINAL";
  const sortedSales = [...args.sales].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return {
    exportDate: new Date().toISOString(),
    selectedDate: args.date,
    periodKey: args.periodKey,
    periodLabel: args.periodLabel,
    periodStart: args.periodStart?.toISOString(),
    periodEnd: sortedSales.at(-1)
      ? new Date(sortedSales.at(-1)!.timestamp).toISOString()
      : undefined,
    merchantId: args.adminPayload?.merchantId,
    merchantName: args.adminPayload?.profile?.name ?? args.adminPayload?.displayName,
    terminalId,
    network: activeNetwork.name,
    rpcUrl: activeNetwork.rpcUrl,
    totalTransactions: sortedSales.length,
    dayFinalized: args.finalize,
    transactions: sortedSales.map((sale: SaleRecord) => ({
      saleId: sale.saleId,
      status: "Finished" as const,
      amount: sale.amountPlanck || "0",
      amountFormatted: sale.amount,
      asset: sale.asset,
      evmMerchant: sale.merchantAddress,
      evmCustomer: sale.customerAddress,
      txHash: sale.transactionHash || "",
      blockNumber: sale.blockNumber?.toString() || "0",
      timestamp: new Date(sale.timestamp).getTime().toString(),
      timestampFormatted: new Date(sale.timestamp).toISOString(),
      terminalId,
      refundOf: null,
      originalCustomer: sale.customerAddress,
      originalMerchant: sale.merchantAddress,
      originalBlockNumber: sale.blockNumber?.toString() || "0",
      originalBlockHash: sale.blockHash || "",
      items: sale.items,
      tip: sale.tip,
    })),
  };
}

/**
 * Hook for generating and uploading daily reports to Bulletin Chain
 * CID is stored locally in IndexedDB instead of on-chain BulletinIndex contract
 */
// Dev-facing labels — only console.log, never shown in UI.
const PHASE_DEV_LABELS: Record<FinalizePhase, string> = {
  idle: "idle",
  generating: "generating report",
  encrypting: "encrypting for recipients",
  uploading: "uploading to bulletin",
  "submitting-onchain": "submitting on-chain",
  "saving-local": "saving locally",
  done: "done",
};

export function useDailyReport(): UseDailyReportReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhaseRaw] = useState<FinalizePhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Wrap setPhase so the developer-facing step name still appears in console
  // (useful for support / debugging) while the UI shows only a generic label.
  const setPhase = (next: FinalizePhase) => {
    console.log(`[DailyReport] phase → ${PHASE_DEV_LABELS[next]}`);
    setPhaseRaw(next);
  };

  const { uploadDailyReport, isUploading } = useBulletin();
  const { account } = useAccount();

  /**
   * Generate daily report from localStorage data
   */
  const generateReport = useCallback(
    async (date: string, merchantAddress: string, finalize = false): Promise<DailyReport> => {
      setIsGenerating(true);
      setError(null);

      try {
        const [sales, adminPayload] = await Promise.all([
          getSalesForDate(date, merchantAddress),
          loadAdminQrPayload(),
        ]);
        const report = buildDailyReportFromSales({
          date,
          periodKey: date,
          sales,
          merchantAddress,
          finalize,
          adminPayload,
        });

        return report;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to generate report";
        setError(message);
        throw err;
      } finally {
        setIsGenerating(false);
      }
    },
    []
  );

  const generateReportForSales = useCallback(
    async (args: PeriodReportArgs): Promise<DailyReport> => {
      setIsGenerating(true);
      setError(null);

      try {
        const adminPayload = await loadAdminQrPayload();
        return buildDailyReportFromSales({
          date: args.date,
          periodKey: args.periodKey,
          sales: args.sales,
          merchantAddress: args.merchantAddress,
          finalize: false,
          adminPayload,
          periodStart: args.periodStart,
          periodLabel: args.periodLabel,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to generate report";
        setError(message);
        throw err;
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  /**
   * Upload report to Bulletin Chain
   */
  const uploadReport = useCallback(
    async (report: DailyReport) => {
      setError(null);
      try {
        return await uploadDailyReport(report);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to upload report";
        setError(message);
        throw err;
      }
    },
    [uploadDailyReport]
  );

  /**
   * Shared report pipeline:
   * 1. Generate report from localStorage data
   * 2. Encrypt (if a manual key is set)
   * 3. Upload to Bulletin Chain
   * 4. Mirror CID on-chain via contract (gated by the on-chain toggle), with
   *    `finalize` deciding whether the day is locked
   * 5. Store CID locally in IndexedDB
   *
   * `saveDailyReport` (finalize=false) is repeatable and overwrites the day's
   * CID; `finalizeDailyReport` (finalize=true) locks it.
   */
  const runReport = useCallback(
    async (
      date: string,
      merchantAddress: string,
      finalize: boolean,
      period?: Omit<PeriodReportArgs, "date" | "merchantAddress">,
    ): Promise<FinalizeDayResult> => {
      setError(null);
      setPhase("generating");
      const reportKey = period?.periodKey ?? date;

      const journey = finalize ? "daily-report-finalize" : "daily-report-save";
      journeyTracker.start(journey, {
        "journey.date": reportKey,
        "journey.terminal": merchantAddress.slice(0, 12),
      });

      try {
        // Identity that scopes the on-chain slot + tags the local record.
        const adminPayload = await loadAdminQrPayload();
        const terminalId = adminPayload?.terminalId ?? "T3RMINAL";
        const merchantId = adminPayload?.merchantId ?? "";

        // 1. Generate report from localStorage or an explicit period slice.
        const report = period
          ? buildDailyReportFromSales({
              date,
              periodKey: reportKey,
              sales: period.sales,
              merchantAddress,
              finalize,
              adminPayload,
              periodStart: period.periodStart,
              periodLabel: period.periodLabel,
            })
          : await generateReport(date, merchantAddress, finalize);
        journeyTracker.milestone(journey, "report-generated");
        journeyTracker.addAttributes(journey, {
          "journey.tx_count": report.totalTransactions,
        });

        if (report.totalTransactions === 0) {
          throw new Error("Cannot build a report for a day with no transactions");
        }

        // 2. Encrypt with the manually configured passphrase, if set
        let reportToUpload: DailyReport | object = report;
        const manualKey = loadManualKey();
        if (manualKey) {
          setPhase("encrypting");
          const fp = manualKeyFingerprint() ?? "";
          reportToUpload = encryptReportSymmetric(
            JSON.stringify(report),
            manualKey,
            {
              date: reportKey,
              txCount: report.totalTransactions,
              terminal: merchantAddress.slice(0, 12),
              keyFingerprint: fp,
            },
          );
          manualKey.fill(0);
          journeyTracker.milestone(journey, "encrypted");
          console.log(`[DailyReport] Encrypted with manual key (fp=${fp})`);
        } else {
          console.log("[DailyReport] No manual key set — uploading plaintext");
        }

        // 3. Upload to Bulletin Chain
        setPhase("uploading");
        const uploadResult = await uploadDailyReport(reportToUpload as DailyReport);
        journeyTracker.milestone(journey, "ipfs-uploaded");

        // 4. Mirror CID on-chain via BulletinIndex contract.
        // Gated by Settings → On-chain indexing (on by default). When off, the
        // CID lives only locally. Needs a merchant+terminal identity — skip
        // gracefully if the terminal hasn't been bound to a merchant yet.
        let onChainIndexed = false;
        const onchainEnabled = await isOnchainIndexingEnabled();
        if (onchainEnabled && isInHost() && account?.address) {
          try {
            if (!merchantId) {
              throw new Error("No merchantId in config — scan an admin QR to enable on-chain indexing.");
            }
            const hostAccounts = await getHostAccounts();
            const hostAccount = hostAccounts.find((ha) => ha.address === account.address);

            if (hostAccount) {
              await storeDailyReportViaRevive(
                hostAccount.address,
                hostAccount.polkadotSigner,
                {
                  merchantId,
                  terminalId,
                  date: reportKey,
                  cid: uploadResult.cid,
                  entryCount: report.totalTransactions,
                  finalize,
                },
                setPhase
              );
              onChainIndexed = true;
              journeyTracker.milestone(journey, "on-chain-indexed");
            }
          } catch (err) {
            console.warn("[DailyReport] On-chain indexing failed (non-critical):", err);
            captureError(err, {
              component: "daily-report",
              phase: "on-chain-index",
              severity: "non-critical",
            });
          }
        }

        // 5. Store CID locally in IndexedDB
        setPhase("saving-local");
        await addDailyReport({
          date: reportKey,
          cid: uploadResult.cid,
          gatewayUrl: uploadResult.gatewayUrl,
          bulletinBlockHash: uploadResult.blockHash,
          entryCount: report.totalTransactions,
          merchantAddress,
          terminalId,
          finalized: finalize,
          signedBy: uploadResult.signedBy,
          publishedAt: new Date(),
          periodClosedAt: finalize ? report.periodEnd ?? new Date().toISOString() : undefined,
        });
        journeyTracker.milestone(journey, "saved-local");

        console.log(`[DailyReport] ${finalize ? "Finalized" : "Saved"} ${reportKey}: ${report.totalTransactions} tx, CID: ${uploadResult.cid.slice(0, 20)}..., on-chain: ${onChainIndexed}`);
        setPhase("done");
        journeyTracker.complete(journey);

        return {
          report,
          cid: uploadResult.cid,
          gatewayUrl: uploadResult.gatewayUrl,
          bulletinBlockHash: uploadResult.blockHash,
          signedBy: uploadResult.signedBy,
          onChainIndexed,
          finalized: finalize,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save report";
        console.error("[DailyReport] Report pipeline failed:", message);
        setError(message);
        setPhase("idle");
        journeyTracker.fail(journey, message);
        captureError(
          err,
          { component: "daily-report", phase: finalize ? "finalize" : "save",
            expected: isExpectedError(message) },
          { date }
        );
        throw err;
      }
    },
    [generateReport, uploadDailyReport, account?.address]
  );

  const saveDailyReport = useCallback(
    (date: string, merchantAddress: string) => runReport(date, merchantAddress, false),
    [runReport]
  );

  const savePeriodReport = useCallback(
    (args: PeriodReportArgs) =>
      runReport(args.date, args.merchantAddress, false, {
        periodKey: args.periodKey,
        sales: args.sales,
        periodStart: args.periodStart,
        periodLabel: args.periodLabel,
      }),
    [runReport],
  );

  const finalizeDailyReport = useCallback(
    (date: string, merchantAddress: string) => runReport(date, merchantAddress, true),
    [runReport]
  );

  const finalizePeriodReport = useCallback(
    (args: PeriodReportArgs) =>
      runReport(args.date, args.merchantAddress, true, {
        periodKey: args.periodKey,
        sales: args.sales,
        periodStart: args.periodStart,
        periodLabel: args.periodLabel,
      }),
    [runReport],
  );

  const isActive = phase !== "idle" && phase !== "done";

  return {
    isGenerating,
    isUploading,
    isFinalizing: isGenerating || isUploading || isActive,
    phase,
    phaseLabel: PHASE_LABELS[phase],
    error,
    generateReport,
    generateReportForSales,
    uploadReport,
    saveDailyReport,
    savePeriodReport,
    finalizeDailyReport,
    finalizePeriodReport,
  };
}
