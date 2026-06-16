"use client";

import { saveFileViaHost } from "@/lib/host/files";

/**
 * Save a generated file, preferring the native host (which writes to the device
 * Downloads folder via MediaStore) and falling back to a normal browser download.
 *
 * Inside the Polkadot host the terminal runs in an Android WebView that silently
 * drops `blob:` / `<a download>` downloads; on the web (Desktop, dot.li, a real
 * browser) there is no host bridge and the anchor download is the right path. This
 * one helper picks the working channel so call sites don't have to.
 */
export async function saveFile(filename: string, blob: Blob): Promise<void> {
  if (await saveFileViaHost(filename, blob)) return;
  browserDownload(filename, blob);
}

/** Convenience for text payloads (CSV, SVG markup, log dumps). */
export async function saveTextFile(
  filename: string,
  text: string,
  mime: string = "text/plain",
): Promise<void> {
  await saveFile(filename, new Blob([text], { type: mime }));
}

/** Classic browser download via a synthetic `<a download>` + object URL. */
function browserDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
