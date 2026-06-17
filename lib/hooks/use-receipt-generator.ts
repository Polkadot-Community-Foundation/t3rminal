import { useState } from "react";
import { usePdfReceipt } from "./use-pdf-receipt";
import { getTimestampFromSaleId } from "@/lib/utils/sale-id";
import { buildReceiptDeeplink, type ReceiptItem } from "@/lib/receipts/receipt-generator";
import { businessProfileFromAdminPayload } from "@/lib/config/business";
import { useAdminQrPayload } from "@/lib/config/admin-qr";

export interface ReceiptData {
  amount: string;
  asset: string;
  merchantAddress: string;
  customerAddress: string;
  transactionId: string;
  blockNumber?: number;
  blockHash?: string;
  assetId: string;
  saleId?: string;
  terminalId?: string;
  merchantId?: string;
  /** Optional itemized rows when the sale came from /items */
  items?: ReceiptItem[];
  /** Items subtotal (before tip) — present when the sale carried a tip. */
  subtotal?: string;
  /** Tip amount added on top of the subtotal. */
  tip?: string;
}

/**
 * Hook that handles receipt generation (SVG with QR and PDF download)
 * Centralizes the try-catch logic and fallback handling
 */
export function useReceiptGenerator() {
  const { generateReceipt, generateSvg, generateSvgWithQR } = usePdfReceipt();
  const adminPayload = useAdminQrPayload();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const business = businessProfileFromAdminPayload(adminPayload);

  /**
   * Generate SVG receipt with embedded QR code
   * Falls back to regular SVG if QR generation fails
   */
  const generateSvgReceipt = async (data: ReceiptData): Promise<string | null> => {
    setIsGenerating(true);
    setError(null);

    // Extract timestamp from SaleId ULID (canonical time), fallback to current time
    const timestamp = data.saleId
      ? getTimestampFromSaleId(data.saleId) ?? new Date()
      : new Date();

    try {
      // Try to generate SVG with QR code
      const svg = await generateSvgWithQR({
        amount: data.amount,
        asset: data.asset,
        merchant: business.name,
        business,
        merchantAddress: data.merchantAddress,
        customerAddress: data.customerAddress,
        transactionId: data.transactionId,
        blockNumber: data.blockNumber,
        blockHash: data.blockHash,
        timestamp,
        assetId: data.assetId,
        saleId: data.saleId,
        terminalId: data.terminalId ?? adminPayload?.terminalId,
        merchantId: data.merchantId ?? adminPayload?.merchantId,
        items: data.items,
        subtotal: data.subtotal,
        tip: data.tip,
      });

      setIsGenerating(false);
      return svg;
    } catch (qrError) {
      console.error("[Receipt Generator] Error generating SVG with QR code:", qrError);

      // Fallback to regular SVG without QR
      try {
        const fallbackSvg = generateSvg({
          amount: data.amount,
          asset: data.asset,
          merchant: business.name,
        business,
          merchantAddress: data.merchantAddress,
          customerAddress: data.customerAddress,
          transactionId: data.transactionId,
          blockNumber: data.blockNumber,
          blockHash: data.blockHash,
          timestamp,
          assetId: data.assetId,
          saleId: data.saleId,
          terminalId: data.terminalId ?? adminPayload?.terminalId,
          merchantId: data.merchantId ?? adminPayload?.merchantId,
          items: data.items,
          subtotal: data.subtotal,
          tip: data.tip,
        });

        setIsGenerating(false);
        return fallbackSvg;
      } catch (fallbackError) {
        console.error("[Receipt Generator] Error generating fallback SVG:", fallbackError);
        setError("Failed to generate receipt");
        setIsGenerating(false);
        return null;
      }
    }
  };

  /**
   * Build the same save-receipt deeplink embedded as the QR on the printed
   * receipt. Sharing this value (rather than a `/receipt/<id>` URL) lets a
   * scanner — or the Polkadot host opening it — rebuild the receipt offline.
   * Timestamp is derived from the SaleId ULID so it matches the rendered QR.
   */
  const buildReceiptQrValue = (data: ReceiptData): string => {
    const timestamp = data.saleId
      ? getTimestampFromSaleId(data.saleId) ?? new Date()
      : new Date();
    return buildReceiptDeeplink(
      {
        amount: data.amount,
        asset: data.asset,
        merchant: business.name,
        business,
        merchantAddress: data.merchantAddress,
        customerAddress: data.customerAddress,
        transactionId: data.transactionId,
        blockNumber: data.blockNumber,
        blockHash: data.blockHash,
        timestamp,
        assetId: data.assetId,
        saleId: data.saleId,
        terminalId: data.terminalId ?? adminPayload?.terminalId,
        merchantId: data.merchantId ?? adminPayload?.merchantId,
        items: data.items,
        tip: data.tip,
      },
      business,
      timestamp,
    );
  };

  /**
   * Download receipt as PDF
   */
  const downloadPdfReceipt = async (data: ReceiptData): Promise<void> => {
    setIsGenerating(true);
    setError(null);

    // Extract timestamp from SaleId ULID (canonical time), fallback to current time
    const timestamp = data.saleId
      ? getTimestampFromSaleId(data.saleId) ?? new Date()
      : new Date();

    try {
      await generateReceipt({
        amount: data.amount,
        asset: data.asset,
        merchant: business.name,
        business,
        merchantAddress: data.merchantAddress,
        customerAddress: data.customerAddress,
        transactionId: data.transactionId,
        blockNumber: data.blockNumber,
        blockHash: data.blockHash,
        timestamp,
        assetId: data.assetId,
        saleId: data.saleId,
        terminalId: data.terminalId ?? adminPayload?.terminalId,
        merchantId: data.merchantId ?? adminPayload?.merchantId,
        items: data.items,
      });

      setIsGenerating(false);
    } catch (err) {
      console.error("[Receipt Generator] Failed to download PDF receipt:", err);
      setError("Failed to download PDF");
      setIsGenerating(false);
      throw err;
    }
  };

  return {
    generateSvgReceipt,
    buildReceiptQrValue,
    downloadPdfReceipt,
    isGenerating,
    error,
  };
}
