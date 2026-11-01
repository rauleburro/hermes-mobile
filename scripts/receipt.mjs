// @ts-check
// Validation receipt: `pnpm validate` stamps the HEAD commit with a
// `Validated-tree: <tree hash>` trailer; `check` passes only if the trailer
// matches the commit's actual tree. Any code change after validation changes
// the tree and so invalidates the receipt. The trailer can be forged by hand:
// this is a guard against forgetting to validate, not a security boundary.
//
// Zero dependencies on purpose: CI runs it with plain `node`, no install.
//
// Usage:
//   node scripts/receipt.mjs stamp
//   node scripts/receipt.mjs check [<commit-ish>]   (default HEAD)
//   node scripts/receipt.mjs pre-push               (git pre-push hook: ref lines on stdin)

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { git } from "./git.mjs";

export const TRAILER_KEY = "Validated-tree";

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GUIDANCE = "Run `pnpm validate` and push again.";

/**
 * Values of every `Validated-tree` trailer in the message's trailer block
 * (the last paragraph, never the first one: that is the subject).
 * @param {string} message
 * @returns {string[]}
 */
export function readTrailer(message) {
  const paragraphs = message
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  if (paragraphs.length < 2) return [];
  const last = /** @type {string} */ (paragraphs[paragraphs.length - 1]);
  const prefix = `${TRAILER_KEY}:`;
  return last
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
}

/**
 * Amend HEAD's message with the current tree hash. The tree is untouched.
 * @param {string} cwd
 * @returns {string} the stamped tree hash
 */
export function stamp(cwd) {
  const dirty = git(cwd, ["status", "--porcelain", "--untracked-files=no"]).trim();
  if (dirty) {
    throw new Error(
      "Refusing to stamp: tracked files have uncommitted changes (staged or unstaged), so the stamp would not describe what is committed. Commit or stash them first.",
    );
  }
  const tree = git(cwd, ["rev-parse", "HEAD^{tree}"]).trim();
  const message = git(cwd, ["log", "-1", "--format=%B", "HEAD"]);
  const stamped = git(
    cwd,
    ["interpret-trailers", "--if-exists", "replace", "--trailer", `${TRAILER_KEY}: ${tree}`],
    message,
  );
  // --allow-empty: the commit may legitimately be empty. --no-verify: no hook loops. verbatim: keep '#' lines of the original message.
  git(cwd, ["commit", "--amend", "--allow-empty", "--no-verify", "--cleanup=verbatim", "-q", "-F", "-"], stamped);
  const after = git(cwd, ["rev-parse", "HEAD^{tree}"]).trim();
  if (after !== tree) throw new Error("Internal error: stamping changed the tree.");
  return tree;
}

/**
 * @param {string} cwd
 * @param {string} [rev]
 * @returns {{ok: boolean, message: string}}
 */
export function check(cwd, rev = "HEAD") {
  let tree;
  let message;
  try {
    tree = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${rev}^{tree}`]).trim();
    message = git(cwd, ["show", "-s", "--format=%B", "--end-of-options", `${rev}^{commit}`]);
  } catch {
    return { ok: false, message: `Cannot resolve commit "${rev}".` };
  }
  const values = readTrailer(message);
  if (values.length === 0) {
    return { ok: false, message: `No ${TRAILER_KEY} trailer on ${rev}: not validated. ${GUIDANCE}` };
  }
  if (values.length > 1) {
    return { ok: false, message: `Multiple ${TRAILER_KEY} trailers on ${rev}: ambiguous. ${GUIDANCE}` };
  }
  const value = /** @type {string} */ (values[0]);
  if (!HASH.test(value)) {
    return { ok: false, message: `Malformed ${TRAILER_KEY} trailer on ${rev} ("${value}"). ${GUIDANCE}` };
  }
  if (value !== tree) {
    return {
      ok: false,
      message: `Stale ${TRAILER_KEY} on ${rev}: it does not match the commit tree (code changed after validation). ${GUIDANCE}`,
    };
  }
  return { ok: true, message: `OK: ${rev} is validated (tree ${tree.slice(0, 12)}).` };
}

const ZERO_SHA = /^0+$/;

/**
 * Parse git's pre-push stdin: `<local ref> <local sha> <remote ref> <remote sha>` per line.
 * @param {string} input
 */
export function parsePushRefs(input) {
  return input
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s+/);
      if (parts.length !== 4) throw new Error(`Unexpected pre-push input line: "${l}"`);
      const [localRef, localSha, remoteRef, remoteSha] = /** @type {[string, string, string, string]} */ (parts);
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

/**
 * Receipt check for every ref being pushed (the local sha, not HEAD).
 * A zero LOCAL sha is a deletion and is skipped; a zero remote sha is a new
 * branch and is checked like any other.
 * @param {string} cwd
 * @param {string} input git's pre-push stdin
 * @returns {{ok: boolean, messages: string[]}}
 */
export function checkPush(cwd, input) {
  let refs;
  try {
    refs = parsePushRefs(input);
  } catch (err) {
    return { ok: false, messages: [err instanceof Error ? err.message : String(err)] };
  }
  /** @type {string[]} */
  const messages = [];
  for (const { localRef, localSha } of refs) {
    if (ZERO_SHA.test(localSha)) continue;
    const result = check(cwd, localSha);
    if (!result.ok) messages.push(`${localRef}: ${result.message}`);
  }
  return { ok: messages.length === 0, messages };
}

/** @param {string[]} argv */
function main(argv) {
  const [command, rev] = argv;
  const cwd = process.cwd();
  if (command === "pre-push") {
    // lefthook/git may append <remote> <url> arguments; they are not needed.
    const result = checkPush(cwd, readFileSync(0, "utf8"));
    for (const m of result.messages) console.error(m);
    return result.ok ? 0 : 1;
  }
  if (command === "stamp" && argv.length === 1) {
    try {
      const tree = stamp(cwd);
      console.log(`Stamped HEAD with ${TRAILER_KEY}: ${tree}`);
      return 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }
  if (command === "check" && argv.length <= 2) {
    const result = check(cwd, rev);
    (result.ok ? console.log : console.error)(result.message);
    return result.ok ? 0 : 1;
  }
  console.error("Usage: node scripts/receipt.mjs stamp | check [<commit-ish>]");
  return 2;
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
