// @ts-check
// `prepare` script: installs the lefthook git hooks after `pnpm install`, but
// never breaks the install: it skips where hooks make no sense (outside a git
// checkout such as a tarball or Docker build, in CI, or when LEFTHOOK=0), and
// only warns if `lefthook install` itself fails.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { git } from "./git.mjs";

/**
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @returns {{install: boolean, reason?: string}}
 */
export function hookInstallPlan(cwd, env) {
  if (env.LEFTHOOK === "0") return { install: false, reason: "LEFTHOOK=0" };
  if (env.CI && env.CI !== "false" && env.CI !== "0") return { install: false, reason: "running in CI" };
  try {
    git(cwd, ["rev-parse", "--git-dir"]);
  } catch {
    return { install: false, reason: "not a git checkout" };
  }
  return { install: true };
}

/**
 * @typedef {(command: string, args: string[]) => {status: number | null, error?: Error}} Spawn
 */

/** @type {Spawn} */
const defaultSpawn = (command, args) =>
  spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });

/**
 * Runs `lefthook install`. Always returns 0: hooks are a convenience and CI is
 * the backstop, so a failure (lefthook missing, `core.hooksPath` set) only
 * prints how to install them by hand instead of failing `pnpm install`.
 * @param {{spawn?: Spawn, warn?: (line: string) => void}} [options]
 * @returns {0}
 */
export function installHooks({ spawn = defaultSpawn, warn = console.warn } = {}) {
  const res = spawn("lefthook", ["install"]);
  if (res.error || res.status !== 0) {
    const why = res.error ? `could not run lefthook (${res.error.message})` : `lefthook exited with ${res.status}`;
    warn(
      `Warning: git hooks were not installed: ${why}. Install them by hand with \`npx lefthook install\`. ` +
        "If git's core.hooksPath is set, lefthook refuses to install: unset it or run the hooks yourself. " +
        "`pnpm validate` and CI still apply.",
    );
  }
  return 0;
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  const plan = hookInstallPlan(process.cwd(), process.env);
  if (!plan.install) {
    console.log(`Skipping git hook install (${plan.reason}).`);
  } else {
    process.exitCode = installHooks();
  }
}
