"use client";

export type PrinterPaperWidth = "Mm58" | "Mm80";
export type PrintDocumentKind = "CustomerReceipt" | "XReport" | "ZReport";

export interface PrintLine {
  label: string;
  value?: string;
}

export interface PrintItem {
  name: string;
  quantity?: string;
  total?: string;
}

export interface PrintQr {
  data: string;
  label?: string;
  moduleSize?: number;
}

export interface PrintDocument {
  kind: PrintDocumentKind;
  paperWidth?: PrinterPaperWidth;
  title: string;
  subtitle?: string;
  header?: PrintLine[];
  body?: PrintLine[];
  items?: PrintItem[];
  totals?: PrintLine[];
  qr?: PrintQr;
  footer?: string[];
}

interface HostPrinter {
  isAvailable(): Promise<boolean>;
  print(document: PrintDocument): Promise<void>;
}

declare global {
  interface Window {
    host?: {
      ext?: {
        printer?: HostPrinter;
      };
    };
  }
}

function getHostPrinter(): HostPrinter | null {
  if (typeof window === "undefined") return null;
  return window.host?.ext?.printer ?? null;
}

export async function isHostPrinterAvailable(): Promise<boolean> {
  const printer = getHostPrinter();
  if (!printer) return false;

  try {
    return await printer.isAvailable();
  } catch {
    return false;
  }
}

export async function printHostDocument(document: PrintDocument): Promise<void> {
  const printer = getHostPrinter();
  if (!printer) throw new Error("Host printer is not available");
  await printer.print({ paperWidth: "Mm58", ...document });
}
