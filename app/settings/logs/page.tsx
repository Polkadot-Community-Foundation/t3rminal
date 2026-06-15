"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ScrollText, Share2, Download, RefreshCw, Trash2, Upload } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import {
  getCapturedLogs,
  clearCapturedLogs,
  formatLogsAsText,
  shareLogs,
  sendLogsTo,
  downloadLogsTxt,
  type ShareLogsResult,
} from "@/lib/debug/log-capture";

const PREVIEW_LINES = 60;
const LOG_URL_KEY = "t3rminal.logIngestUrl";

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
  const [url, setUrl] = useState("");

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

  // Remember the last ingest URL (falls back to a build-time default).
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LOG_URL_KEY);
    } catch {
      // localStorage may be unavailable in the host webview.
    }
    setUrl(saved ?? process.env.NEXT_PUBLIC_LOG_INGEST_URL ?? "");
  }, []);

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

  const onSend = async () => {
    const target = url.trim();
    if (!target) return;
    setBusy(true);
    setStatus(null);
    try {
      try {
        localStorage.setItem(LOG_URL_KEY, target);
      } catch {
        // persistence is best-effort
      }
      await sendLogsTo(target);
      setStatus("Logs sent to backend.");
    } catch (err) {
      setStatus(`Send failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async () => {
    try {
      await downloadLogsTxt();
      setStatus("Logs saved as a .txt file.");
    } catch (err) {
      setStatus(`Save failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  };

  const onClear = () => {
    clearCapturedLogs();
    setStatus("Logs cleared.");
    refresh();
  };

  return (
    <div className="h-dvh bg-black flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex flex-col max-w-md mx-auto w-full">
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

        <main className="flex-1 min-h-0 px-6 py-4 space-y-6 overflow-auto">
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
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-log-service/ingest/<terminalId>"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
            />
            <button
              onClick={onSend}
              disabled={busy || count === 0 || url.trim() === ""}
              className="w-full flex items-center justify-center gap-2 bg-white text-black font-medium rounded-xl p-4 transition disabled:opacity-40"
            >
              <Upload className="w-5 h-5" />
              {busy ? "Sending…" : "Send logs"}
            </button>

            <button
              onClick={onShare}
              disabled={busy || count === 0}
              className="w-full flex items-center justify-center gap-2 bg-neutral-900 border border-neutral-800 text-white font-medium rounded-xl p-4 transition hover:bg-neutral-800 disabled:opacity-40"
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
      <BottomNav />
    </div>
  );
}
