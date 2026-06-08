#!/usr/bin/env node
/**
 * Zero-prerequisite entry point for `npm run deploy`.
 *
 * deploy.ts runs under tsx, which only exists after `npm install`. This
 * bootstrap uses nothing but Node built-ins, so it runs even on a freshly
 * cloned repo with no node_modules: it installs dependencies if they're
 * missing, then hands off to the real (tsx-powered) interactive deploy. The
 * operator runs one command and the tooling installs everything it needs.
 *
 * The mnemonic is never touched here — it's only ever entered inside deploy.ts
 * and passed in-memory to bulletin-deploy. Nothing secret is written to disk.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` exited with ${result.status}.`);
  }
}

// tsx lives in the repo's node_modules/.bin after `npm install`.
function findTsx() {
  return [resolve(APP_ROOT, "node_modules", ".bin", "tsx")].find(existsSync);
}

// Inline ANSI (can't import scripts/lib/style.ts — that needs tsx, which may not
// be installed yet). Same TTY/NO_COLOR/dumb gate as the styled CLI it hands to.
const COLOR =
  !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const paint = (open) => (s) => (COLOR ? `${open}${s}\x1b[0m` : s);
const dim = paint("\x1b[2m");
const bold = paint("\x1b[1m");
const green = paint("\x1b[32m");
const red = paint("\x1b[31m");

try {
  // No banner here — deploy.ts prints the single T3RMINAL banner once tsx takes
  // over. This stage is just the (usually invisible) prerequisite check.
  if (findTsx()) {
    console.log(dim("• prerequisites ready"));
  } else {
    console.log(bold("• installing dependencies (first run)…"));
    run("npm", ["install"], { cwd: APP_ROOT });
    console.log(`${green("✓")} dependencies installed`);
  }

  const tsx = findTsx();
  if (!tsx) {
    throw new Error(
      "tsx is still missing after `npm install`. Check the install output above.",
    );
  }

  run(tsx, ["scripts/deploy.ts"], { cwd: APP_ROOT });
} catch (error) {
  console.error(
    `${red("✗")} deploy bootstrap failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
