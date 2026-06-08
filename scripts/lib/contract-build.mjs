// Shared hashing helpers for the contract build/deploy scripts.
//
// Used by sync-contract-artifacts.mjs (records the source hash that produced the
// committed bytecode) and deploy.ts (decides whether the committed bytecode is
// still current, so it can skip recompiling when the contract is unchanged).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** All *.sol files under `dir`, recursively, as sorted absolute paths. */
export function listSolFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".sol")) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Stable SHA-256 over every Solidity source under `srcDir` (relative path +
 * content), so any edit, rename, add, or remove changes the digest. This is the
 * signal for "did the contract change?" — independent of build artifacts.
 */
export function sourceHashOf(srcDir) {
  const hash = createHash("sha256");
  for (const file of listSolFiles(srcDir)) {
    hash.update(relative(srcDir, file).split("\\").join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}
