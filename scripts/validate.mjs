// @ts-check
// `pnpm validate`: the local gate before a PR. On a clean, committed tree it
// runs test, typecheck, lint and the hygiene check in order, and only if all
// pass stamps HEAD with a `Validated-tree` receipt (see receipt.mjs). Any
// failure stops the run with a non-zero exit and no stamp.
//
// The tree must be clean up front (tracked files only): the stamp describes
// the committed tree, so there is no point running a minute of tests first.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { git } from "./git.mjs";
import { stamp } from "./receipt.mjs";

/** @typedef {{name: string, command: string, args: string[]}} Step */

/** @type {Step[]} */
export const DEFAULT_STEPS = [
  { name: "test", command: "pnpm", args: ["test"] },
  { name: "typecheck", command: "pnpm", args: ["typecheck"] },
  { name: "lint", command: "pnpm", args: ["lint"] },
  { name: "hygiene", command: process.execPath, args: ["scripts/hygiene.mjs"] },
];

/**
 * @param {{cwd: string, steps?: Step[], stdio?: "inherit" | "ignore", log?: (line: string) => void}} options
 * @returns {{ok: boolean, message: string, failedStep?: string}}
 */
export function runValidate({ cwd, steps = DEFAULT_STEPS, stdio = "inherit", log = console.log }) {
  if (git(cwd, ["status", "--porcelain", "--untracked-files=no"]).trim()) {
    return {
      ok: false,
      message: "Tracked files have uncommitted changes. Commit first (validation stamps the committed tree), then run `pnpm validate`.",
    };
  }
  for (const step of steps) {
    log(`\n==> ${step.name}: ${[step.command, ...step.args].join(" ")}`);
    const res = spawnSync(step.command, step.args, { cwd, stdio, shell: process.platform === "win32" });
    if (res.error || res.status !== 0) {
      return { ok: false, failedStep: step.name, message: `Validation failed at "${step.name}". Nothing was stamped.` };
    }
  }
  try {
    const tree = stamp(cwd);
    return { ok: true, message: `Validated: stamped HEAD with tree ${tree}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = runValidate({ cwd: root });
  (result.ok ? console.log : console.error)(result.message);
  process.exitCode = result.ok ? 0 : 1;
}
