"use client";

import { useState } from "react";
import Link from "next/link";
import { X, History, Search, RefreshCw, ArrowDownLeft, FileText, Download, Loader2, CheckCircle } from "lucide-react";
import { useAccount } from "@/lib/web3";
import { BottomNav } from "@/components/bottom-nav";
import { useSalesHistory, type SaleRecord } from "@/lib/storage";
import { useReceiptGenerator } from "@/lib/hooks/use-receipt-generator";
import { formatMoney } from "@/lib/utils/format";
import { useAssetSymbol } from "@/lib/utils/asset-metadata";

export default function HistoryPage() {
  const symbol = useAssetSymbol();
  const { account } = useAccount();
  const { groupedSales, searchTerm, setSearchTerm, isLoading, isEmpty } = useSalesHistory();
  const { generateSvgReceipt, downloadPdfReceipt } = useReceiptGenerator();
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [svgReceipt, setSvgReceipt] = useState<string | null>(null);

  // Not connected state
  if (!account) {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            <div className="text-center space-y-3 w-full">
              <h1 className="text-2xl font-semibold text-white">Welcome</h1>
              <p className="text-neutral-500 text-sm">Connecting to host…</p>
            </div>
          </main>
        </div>
        <BottomNav />
      </div>
    );
  }

  // Handle view receipt
  const handleViewReceipt = async (sale: SaleRecord) => {
    setSelectedSale(sale);
    setShowReceipt(true);
    const svg = await generateSvgReceipt({
      amount: sale.amount,
      asset: sale.asset,
      merchantAddress: sale.merchantAddress,
      customerAddress: sale.customerAddress,
      transactionId: sale.transactionHash || "",
      blockNumber: sale.blockNumber,
      blockHash: sale.blockHash,
      assetId: sale.assetId,
      saleId: sale.saleId,
      items: sale.items,
    });
    if (svg) {
      setSvgReceipt(svg);
    }
  };

  // Handle download receipt
  const handleDownloadReceipt = async (sale: SaleRecord) => {
    await downloadPdfReceipt({
      amount: sale.amount,
      asset: sale.asset,
      merchantAddress: sale.merchantAddress,
      customerAddress: sale.customerAddress,
      transactionId: sale.transactionHash || "",
      blockNumber: sale.blockNumber,
      blockHash: sale.blockHash,
      assetId: sale.assetId,
      saleId: sale.saleId,
      items: sale.items,
    });
  };

  // Receipt view — opened directly from the history list (no intermediate
  // details page). Skeleton renders while the SVG generates.
  if (selectedSale && showReceipt) {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-4">
            <button
              onClick={() => { setSelectedSale(null); setShowReceipt(false); setSvgReceipt(null); }}
              className="p-2"
            >
              <X className="w-6 h-6 text-white" />
            </button>
            <span className="text-white font-medium">Record #{selectedSale.saleId.slice(-4)}</span>
            <button onClick={() => handleDownloadReceipt(selectedSale)} className="p-2">
              <Download className="w-6 h-6 text-white" />
            </button>
          </header>

          <main className="flex-1 flex flex-col px-6 py-4 overflow-auto">
            <div className="bg-white rounded-xl p-4 overflow-hidden">
              {svgReceipt ? (
                <div dangerouslySetInnerHTML={{ __html: svgReceipt }} />
              ) : (
                <div className="flex items-center justify-center py-20">
                  <RefreshCw className="w-6 h-6 text-neutral-400 animate-spin" />
                </div>
              )}
            </div>
          </main>
        </div>
        <BottomNav />
      </div>
    );
  }

  // Main History view
  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4">
          <Link href="/" className="p-2">
            <X className="w-6 h-6 text-white" />
          </Link>
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-white" />
            <span data-testid="history-header" className="text-white font-medium">Transaction History</span>
          </div>
          <div className="w-10" />
        </header>

        {/* Search Section */}
        <div className="px-6 pb-4 pt-2">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
            <input
              data-testid="history-search"
              type="text"
              placeholder="Type Sale ID"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-neutral-800 text-white placeholder-neutral-500 rounded-xl py-3 pl-12 pr-4 outline-none focus:ring-2 focus:ring-neutral-600"
            />
          </div>
        </div>

        {/* Main Content */}
        <main className="flex-1 min-h-0 flex flex-col px-6 overflow-hidden">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <RefreshCw className="w-8 h-8 text-neutral-500 animate-spin" />
            </div>
          ) : isEmpty ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8">
              <FileText className="w-16 h-16 text-neutral-600 mb-4" />
              <h2 data-testid="history-empty" className="text-xl font-semibold text-white mb-2">No Transactions Yet</h2>
              <p className="text-neutral-500 text-sm text-center max-w-xs">
                Your payment history will appear here once you start accepting or making payments.
              </p>
            </div>
          ) : (
            <div className="space-y-6 pb-4 overflow-y-auto flex-1">
              {Object.entries(groupedSales).map(([dateGroup, sales]) => (
                <div key={dateGroup}>
                  <h3 className="text-neutral-500 text-sm font-medium mb-3">{dateGroup}</h3>
                  <div className="space-y-2">
                    {sales.map((sale) => (
                      <button
                        key={sale.saleId}
                        onClick={() => handleViewReceipt(sale)}
                        className="w-full flex items-center gap-3 py-3 border-b border-neutral-800 hover:bg-neutral-900 rounded-lg transition text-left"
                      >
                        {/* Avatar with icon */}
                        <div className="relative">
                          <div className={`w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center`}>
                            <ArrowDownLeft className="w-5 h-5 text-neutral-400" />
                          </div>
                          <div className="absolute -bottom-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-green-500 flex items-center justify-center">
                            <span className="text-white text-[10px] font-medium">{formatMoney(sale.amount)}</span>
                          </div>
                        </div>

                        {/* Sale ID (or customer name when set) */}
                        <div className="flex-1">
                          <p className="text-white font-medium text-lg flex items-center gap-1.5">
                            {sale.customerName ?? `#${sale.saleId.slice(-4).toUpperCase()}`}
                            {/* Finality indicator: green check once
                                lib/payments/finalization-watcher.ts stamps
                                `finalizedAt`, hourglass while still pending. */}
                            {sale.finalizedAt ? (
                              <CheckCircle
                                className="w-4 h-4 text-green-500"
                                aria-label="Finalized on chain"
                              />
                            ) : (
                              <Loader2
                                className="w-3.5 h-3.5 text-neutral-500 animate-spin"
                                aria-label="Confirming on chain"
                              />
                            )}
                          </p>
                        </div>

                        {/* Amount */}
                        <span className="text-green-400 font-medium">
                          +{formatMoney(sale.amount)} {symbol}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
