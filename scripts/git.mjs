// @ts-check
// Shared git helper for the repo scripts. Hooks export GIT_DIR / GIT_INDEX_FILE
// and friends; `cwd` must decide which repo we hit, so they are stripped.

import { execFileSync } from "node:child_process";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {string} [input]
 */
export function git(cwd, args, input) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].includes(k)),
  );
  return execFileSync("git", args, { cwd, env, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}
