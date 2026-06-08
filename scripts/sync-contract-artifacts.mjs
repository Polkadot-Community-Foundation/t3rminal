#!/usr/bin/env node
/**
 * Rebuild the committed contract artifacts from source — the one command to run
 * after editing contracts/src/T3rminalBulletinIndex.sol (or its interface).
 *
 * This is the in-repo replacement for the regeneration cdm used to do. It
 * compiles the contract with Hardhat + @parity/resolc and refreshes the two
 * artifacts the rest of the repo consumes, so they never drift from the source:
 *
 *   - contracts/bytecode/T3rminalBulletinIndex.polkavm   ← deploy input
 *       scripts/deploy-bulletin-index.ts reads this to instantiate via
 *       pallet-revive. Checked in so a deploy needs no contract toolchain.
 *   - lib/contracts/abis.ts                              ← app ABI
 *       lib/contracts/revive-bulletin-index.ts builds an ethers.Interface from
 *       this typed export.
 *
 * `hardhat compile` embeds the PolkaVM bytecode in its artifact JSON's
 * `bytecode` field (no standalone .polkavm is emitted), so the blob is extracted
 * from there. After running, commit the source plus these two regenerated files.
 *
 * Usage:  npm run build:contracts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceHashOf } from "./lib/contract-build.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, "..");
const CONTRACTS_DIR = resolve(APP_ROOT, "contracts");
const ARTIFACT = resolve(
  CONTRACTS_DIR,
  "artifacts/src/T3rminalBulletinIndex.sol/T3rminalBulletinIndex.json",
);
const BYTECODE_OUT = resolve(APP_ROOT, "contracts/bytecode/T3rminalBulletinIndex.polkavm");
const ABI_OUT = resolve(APP_ROOT, "lib/contracts/abis.ts");
const BUILD_INFO_OUT = resolve(APP_ROOT, "contracts/bytecode/build-info.json");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` exited with ${result.status}.`);
  }
}

// 1. Ensure the contract toolchain is present (Hardhat + resolc live in
//    contracts/node_modules, which is gitignored), then compile. Hardhat is
//    incremental, so this is a near no-op when the source is unchanged.
if (!existsSync(resolve(CONTRACTS_DIR, "node_modules"))) {
  console.log("• installing contract toolchain (first run)…");
  run("npm", ["install"], CONTRACTS_DIR);
}
console.log("• compiling contract (hardhat + resolc)…");
run("npm", ["run", "compile"], CONTRACTS_DIR);

if (!existsSync(ARTIFACT)) {
  throw new Error(`Expected Hardhat artifact at ${ARTIFACT} after compile.`);
}
const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));

// 2. PolkaVM bytecode → the checked-in blob the deploy reads.
const bytecode = artifact.bytecode;
if (typeof bytecode !== "string" || !bytecode.startsWith("0x") || bytecode.length <= 2) {
  throw new Error("Artifact has no usable `bytecode` field — did resolc compilation succeed?");
}
const blob = Buffer.from(bytecode.slice(2), "hex");
mkdirSync(dirname(BYTECODE_OUT), { recursive: true });
writeFileSync(BYTECODE_OUT, blob);

// 3. ABI → the app's typed ABI module. Match the existing format exactly
//    (2-space JSON, `as const`) so the diff stays empty when nothing changed.
const abiTs =
  "// Auto-generated ABI from compiled T3rminalBulletinIndex contract\n" +
  "// Do not edit manually - regenerate with: npm run build:contracts\n\n" +
  `export const T3rminalBulletinIndexABI = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;
writeFileSync(ABI_OUT, abiTs);

// 4. Record the source hash that produced these artifacts, so `npm run deploy`
//    can tell whether the committed bytecode is still current without needing
//    the contract toolchain — it skips recompiling when the .sol is unchanged.
const sourceHash = sourceHashOf(resolve(CONTRACTS_DIR, "src"));
writeFileSync(BUILD_INFO_OUT, `${JSON.stringify({ sourceHash }, null, 2)}\n`);

console.log(`✓ bytecode   → contracts/bytecode/T3rminalBulletinIndex.polkavm (${blob.length} B)`);
console.log(`✓ abi        → lib/contracts/abis.ts (${artifact.abi.length} entries)`);
console.log(`✓ build-info → contracts/bytecode/build-info.json (sourceHash ${sourceHash.slice(0, 12)}…)`);
console.log("Done. Commit the source + these regenerated files.");
