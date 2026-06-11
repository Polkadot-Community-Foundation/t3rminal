"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ScrollText, Share2, Download, RefreshCw, Trash2 } from "lucide-react";
import {
  getCapturedLogs,
  clearCapturedLogs,
  formatLogsAsText,
  shareLogs,
  downloadLogsTxt,
  type ShareLogsResult,
} from "@/lib/debug/log-capture";

const PREVIEW_LINES = 60;

const RESULT_LABEL: Record<ShareLogsResult, string> = {
  shared: "Logs shared.",
  copied: "Logs copied to clipboard.",
  downloaded: "Logs downloaded as a file.",
  cancelled: "Share cancelled.",
};

export default function LogsPage() {
  const [count, setCount] = useState(0);
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    const logs = getCapturedLogs();
    setCount(logs.length);
    // Show only the tail so the page stays light even with a full buffer.
    const text = formatLogsAsText();
    const lines = text.split("\n");
    setPreview(lines.slice(-PREVIEW_LINES).join("\n"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onShare = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await shareLogs();
      setStatus(RESULT_LABEL[result]);
    } catch {
      setStatus("Couldn't export logs.");
    } finally {
      setBusy(false);
    }
  };

  const onDownload = () => {
    downloadLogsTxt();
    setStatus("Logs saved as a .txt file.");
  };

  const onClear = () => {
    clearCapturedLogs();
    setStatus("Logs cleared.");
    refresh();
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-4">
          <Link href="/settings" className="p-2">
            <ArrowLeft className="w-6 h-6 text-white" />
          </Link>
          <div className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-white" />
            <span className="text-white font-medium">Debug logs</span>
          </div>
          <button onClick={refresh} className="p-2" aria-label="Refresh">
            <RefreshCw className="w-5 h-5 text-neutral-400" />
          </button>
        </header>

        <main className="flex-1 px-6 py-4 space-y-6 overflow-auto">
          <p className="text-neutral-400 text-sm">
            Captured console output and uncaught errors from this session. Share
            them to help debug an issue on a device with no dev console.
          </p>

          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex items-center justify-between">
            <span className="text-white font-medium">Captured lines</span>
            <span className="text-neutral-300 tabular-nums">{count}</span>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={onShare}
              disabled={busy || count === 0}
              className="w-full flex items-center justify-center gap-2 bg-white text-black font-medium rounded-xl p-4 transition disabled:opacity-40"
            >
              <Share2 className="w-5 h-5" />
              {busy ? "Exporting…" : "Share logs"}
            </button>

            <button
              onClick={onDownload}
              disabled={busy || count === 0}
              className="w-full flex items-center justify-center gap-2 bg-neutral-900 border border-neutral-800 text-white font-medium rounded-xl p-4 transition hover:bg-neutral-800 disabled:opacity-40"
            >
              <Download className="w-5 h-5" />
              Save as .txt
            </button>

            <button
              onClick={onClear}
              disabled={busy || count === 0}
              className="w-full flex items-center justify-center gap-2 bg-neutral-900 border border-neutral-800 text-red-400 font-medium rounded-xl p-4 transition hover:bg-neutral-800 disabled:opacity-40"
            >
              <Trash2 className="w-5 h-5" />
              Clear logs
            </button>
          </div>

          {status && (
            <p data-testid="logs-status" className="text-neutral-300 text-sm text-center">
              {status}
            </p>
          )}

          {/* Tail preview */}
          <div>
            <p className="text-neutral-500 text-xs mb-2 uppercase tracking-wide">
              Latest ({PREVIEW_LINES} lines)
            </p>
            <pre className="bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-[10px] leading-relaxed text-neutral-400 overflow-auto max-h-80 whitespace-pre-wrap break-words">
              {preview || "No logs captured yet."}
            </pre>
          </div>
        </main>
      </div>
    </div>
  );
}
