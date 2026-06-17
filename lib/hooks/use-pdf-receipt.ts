import { jsPDF } from "jspdf";
import { generateReceiptSVG, generateReceiptSVGWithQR, downloadSVG, type ReceiptData as SvgReceiptData } from "@/lib/receipts/receipt-generator";
import { saveFile } from "@/lib/utils/save-file";

export interface ReceiptData extends SvgReceiptData {
  assetId: string;
}

/**
 * Rasterize an SVG string into a PNG data URL via an offscreen canvas.
 * The SVG must carry explicit pixel `width`/`height` — a bare `width="100%"`
 * has no intrinsic size for an <img> and renders 0×0. Embedded data-URI
 * images (the receipt QR) don't taint the canvas, so `toDataURL` is safe.
 */
function svgToPngDataUrl(svg: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context unavailable");
        // Paper-white backing in case the SVG's own rect doesn't fully cover.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        reject(err as Error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load receipt SVG for rasterization"));
    };
    img.src = url;
  });
}

/**
 * Hook to generate PDF and SVG receipts for payments
 */
export function usePdfReceipt() {
  const generateSvg = (data: ReceiptData): string => {
    return generateReceiptSVG(data);
  };

  const downloadReceiptSvg = async (data: ReceiptData): Promise<void> => {
    const svg = generateReceiptSVG(data);
    const filename = `receipt-${data.transactionId.slice(0, 8)}.svg`;
    await downloadSVG(svg, filename);
  };

  const generateSvgWithQR = async (data: ReceiptData): Promise<string> => {
    return generateReceiptSVGWithQR(data);
  };

  const downloadReceiptSvgWithQR = async (data: ReceiptData): Promise<void> => {
    const svg = await generateReceiptSVGWithQR(data);
    const filename = `receipt-${data.transactionId.slice(0, 8)}-qr.svg`;
    await downloadSVG(svg, filename);
  };

  const generateReceipt = async (data: ReceiptData): Promise<void> => {
    try {
      // Render the exact same Quittung SVG (with embedded QR) the merchant
      // sees on screen, then rasterize it into the PDF. This keeps the
      // downloaded PDF pixel-identical to the in-app receipt instead of
      // drifting from a hand-built jsPDF layout.
      const svg = await generateReceiptSVGWithQR(data);

      // Pull intrinsic dimensions from the viewBox so the canvas and PDF
      // page both match the receipt's aspect ratio exactly.
      const viewBoxMatch = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const svgW = viewBoxMatch ? parseFloat(viewBoxMatch[1]) : 320;
      const svgH = viewBoxMatch ? parseFloat(viewBoxMatch[2]) : 600;

      // Give the SVG concrete pixel dimensions before rasterizing and
      // supersample (×3) so text and the QR stay crisp in the PDF.
      const scale = 3;
      const pxW = Math.round(svgW * scale);
      const pxH = Math.round(svgH * scale);
      const sized = svg.replace(
        /(<svg\b[^>]*?)\swidth="100%"/,
        `$1 width="${pxW}" height="${pxH}"`,
      );

      const pngDataUrl = await svgToPngDataUrl(sized, pxW, pxH);

      // PDF page sized to the receipt's aspect ratio on an 80mm thermal roll.
      const pageWidth = 80; // mm
      const pageHeight = (svgH / svgW) * pageWidth;
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [pageWidth, pageHeight],
      });
      pdf.addImage(pngDataUrl, "PNG", 0, 0, pageWidth, pageHeight);

      const fileName = `receipt-${data.transactionId.slice(0, 8)}.pdf`;
      await saveFile(fileName, pdf.output("blob"));
    } catch (error) {
      console.error("Error generating PDF receipt:", error);
      throw new Error("Failed to generate receipt");
    }
  };

  return {
    generateReceipt,
    generateSvg,
    downloadReceiptSvg,
    generateSvgWithQR,
    downloadReceiptSvgWithQR,
  };
}
