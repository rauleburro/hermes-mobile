// @ts-check
// `prepare` script: installs the lefthook git hooks after `pnpm install`, but
// never breaks the install where hooks make no sense: outside a git checkout
// (tarball, Docker build), in CI, or when LEFTHOOK=0.

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

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  const plan = hookInstallPlan(process.cwd(), process.env);
  if (!plan.install) {
    console.log(`Skipping git hook install (${plan.reason}).`);
  } else {
    const res = spawnSync("lefthook", ["install"], { stdio: "inherit", shell: process.platform === "win32" });
    process.exitCode = res.status ?? 1;
  }
}
