// @ts-check
// Generic public-repo hygiene check. Scans git-TRACKED files for things that
// must never be committed to a public repository:
//
//   home-path    absolute home-directory paths (macOS, Linux, Windows) with a
//                real user name. Placeholders (`<name>`, `$USER`, `...`) and
//                shared system dirs are fine.
//   env-file     a tracked `.env` / `.env.<name>` file (`.env.example`,
//                `.env.sample`, `.env.template` are allowed).
//   private-key  a PEM private key block header.
//   token        GitHub tokens (`ghp_...`, `github_pat_...`) and AWS access key ids.
//
// Allowing a legitimate mention: put the marker `hygiene-allow` anywhere on
// the same line (usually inside a comment). It exempts that line only. The
// lockfile and binary files are never scanned. Untracked files are ignored.
//
// Hits are printed as `file:line: rule` and never echo the matched text, so a
// real secret does not end up in terminal or CI logs. The working tree is
// scanned (not the index): good enough for a clean tree (`pnpm validate`),
// and a staged-then-reverted leak is the one thing the pre-commit run misses.
//
// Zero dependencies on purpose: CI runs it with plain `node`, no install.
//
// Usage: node scripts/hygiene.mjs        (exit 0 clean, 1 on any hit)

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./git.mjs";

export const ALLOW_MARKER = "hygiene-allow";

/** @typedef {{file: string, line: number, rule: string}} Hit */

const NAME = "[A-Za-z0-9_][A-Za-z0-9._-]*";
// What may follow a user name for it to count as a path component.
const END = "(?=[\\\\/\\s\"'`)\\]},;:]|$)";
// Bracketed first letters keep this file's own source out of a plain-text grep.
const UNIX_HOME = new RegExp(`(?<![\\w.~-])/(?:[U]sers|[h]ome)/(${NAME})${END}`, "g");
const WIN_HOME = new RegExp(`(?<!\\w)[A-Za-z]:[\\\\/]+[U]sers[\\\\/]+(${NAME})${END}`, "g");
// Shared directories and conventional placeholders: not a person.
const NOT_A_PERSON = new Set(["shared", "public", "default", "runner", "user", "username", "example"]);

/** @param {RegExp} re @param {string} line */
function hasPersonalPath(re, line) {
  for (const m of line.matchAll(re)) {
    if (!NOT_A_PERSON.has(/** @type {string} */ (m[1]).toLowerCase())) return true;
  }
  return false;
}

/** @type {{rule: string, test: (line: string) => boolean}[]} */
const LINE_RULES = [
  { rule: "home-path", test: (l) => hasPersonalPath(UNIX_HOME, l) || hasPersonalPath(WIN_HOME, l) },
  { rule: "private-key", test: (l) => /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/.test(l) },
  {
    rule: "token",
    test: (l) =>
      /\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(l) ||
      /\bgithub_pat_[A-Za-z0-9_]{22,}/.test(l) ||
      /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/.test(l),
  },
];

/**
 * @param {string} file repo-relative path, used only for reporting
 * @param {string} text
 * @returns {Hit[]}
 */
export function scanText(file, text) {
  /** @type {Hit[]} */
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const { rule, test } of LINE_RULES) {
      if (test(line)) hits.push({ file, line: i + 1, rule });
    }
  });
  return hits;
}

const ENV_FILE = /(?:^|\/)\.env(?:\..+)?$/;
const ENV_TEMPLATE = /\.(?:example|sample|template)$/;

/**
 * Path-level rules (line 0 = whole file).
 * @param {string} file repo-relative path
 * @returns {Hit[]}
 */
export function scanPath(file) {
  if (ENV_FILE.test(file) && !ENV_TEMPLATE.test(file)) return [{ file, line: 0, rule: "env-file" }];
  return [];
}

/** @param {Hit} hit */
export function formatHit(hit) {
  const where = hit.line > 0 ? `${hit.file}:${hit.line}` : hit.file;
  return `${where}: ${hit.rule}`;
}

const SKIP_FILES = new Set(["pnpm-lock.yaml"]);

/**
 * Scan every tracked file in the repo at `cwd`.
 * @param {string} cwd
 * @returns {Hit[]}
 */
export function scanRepo(cwd) {
  const files = git(cwd, ["ls-files", "-z"]).split("\0").filter(Boolean);
  /** @type {Hit[]} */
  const hits = [];
  for (const file of files) {
    hits.push(...scanPath(file));
    if (SKIP_FILES.has(basename(file))) continue;
    const abs = join(cwd, file);
    let buf;
    try {
      if (!lstatSync(abs).isFile()) continue; // symlinks, submodules
      buf = readFileSync(abs);
    } catch {
      continue; // tracked but deleted from the working tree
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    hits.push(...scanText(file, buf.toString("utf8")));
  }
  return hits;
}

function main() {
  let hits;
  try {
    hits = scanRepo(process.cwd());
  } catch (err) {
    console.error(`hygiene: cannot scan (${err instanceof Error ? err.message : String(err)})`);
    return 1;
  }
  if (hits.length === 0) {
    console.log("hygiene: OK");
    return 0;
  }
  for (const hit of hits) console.error(formatHit(hit));
  console.error(
    `hygiene: ${hits.length} hit(s). Remove the content, or add \`${ALLOW_MARKER}\` to a line that legitimately mentions it.`,
  );
  return 1;
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
