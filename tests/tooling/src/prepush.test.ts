import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "../../../scripts/git.mjs";
import { checkPush, parsePushRefs, stamp } from "../../../scripts/receipt.mjs";

const SCRIPT = resolve(import.meta.dirname, "../../../scripts/receipt.mjs");
const SHA = "a".repeat(40);
const ZERO = "0".repeat(40);

describe("parsePushRefs", () => {
  it("parses git's pre-push stdin lines", () => {
    const other = "b".repeat(40);
    const input = `refs/heads/a ${SHA} refs/heads/a ${ZERO}\nrefs/tags/v1 ${other} refs/tags/v1 ${ZERO}\n`;
    expect(parsePushRefs(input)).toEqual([
      { localRef: "refs/heads/a", localSha: SHA, remoteRef: "refs/heads/a", remoteSha: ZERO },
      { localRef: "refs/tags/v1", localSha: other, remoteRef: "refs/tags/v1", remoteSha: ZERO },
    ]);
  });

  it("ignores blank lines and returns nothing for empty input", () => {
    expect(parsePushRefs("")).toEqual([]);
    expect(parsePushRefs("\n\n")).toEqual([]);
  });

  it("throws on a line that is not four fields", () => {
    expect(() => parsePushRefs("refs/heads/a only-two\n")).toThrow(/pre-push/i);
  });
});

describe("checkPush in a throwaway repo", () => {
  let repo: string;

  function commitFile(name: string, content: string, msg: string) {
    writeFileSync(join(repo, name), content);
    git(repo, ["add", name]);
    git(repo, ["commit", "-q", "-m", msg]);
  }
  const head = () => git(repo, ["rev-parse", "HEAD"]).trim();
  const line = (ref: string, sha: string, remote = ZERO) => `${ref} ${sha} ${ref} ${remote}\n`;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "receipt-push-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.name", "Test"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    commitFile("a.txt", "one\n", "first");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("passes a stamped commit", () => {
    stamp(repo);
    expect(checkPush(repo, line("refs/heads/main", head())).ok).toBe(true);
  });

  it("fails an unstamped commit, naming the ref and the guidance", () => {
    const r = checkPush(repo, line("refs/heads/main", head()));
    expect(r.ok).toBe(false);
    expect(r.messages.join("\n")).toContain("refs/heads/main");
    expect(r.messages.join("\n")).toContain("pnpm validate");
  });

  it("checks the pushed sha, not HEAD", () => {
    stamp(repo);
    const validated = head();
    commitFile("b.txt", "x\n", "later, unvalidated");
    expect(checkPush(repo, line("refs/heads/main", validated)).ok).toBe(true);
    expect(checkPush(repo, line("refs/heads/main", head())).ok).toBe(false);
  });

  it("checks every ref and fails if any one is unvalidated", () => {
    stamp(repo);
    const good = head();
    commitFile("b.txt", "x\n", "later");
    const r = checkPush(repo, line("refs/heads/ok", good) + line("refs/heads/bad", head()));
    expect(r.ok).toBe(false);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toContain("refs/heads/bad");
  });

  it("skips a deletion (zero local sha) but still checks a new branch (zero remote sha)", () => {
    expect(checkPush(repo, `(delete) ${ZERO} refs/heads/old ${SHA}\n`).ok).toBe(true);
    expect(checkPush(repo, line("refs/heads/new", head(), ZERO)).ok).toBe(false);
  });

  it("passes when there is nothing to push", () => {
    expect(checkPush(repo, "").ok).toBe(true);
  });

  it("fails closed on unparseable input", () => {
    expect(checkPush(repo, "garbage\n").ok).toBe(false);
  });

  it("CLI pre-push reads stdin: exit 1 unstamped, 0 stamped, extra args ignored", () => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
    const run = (input: string) =>
      spawnSync("node", [SCRIPT, "pre-push", "origin", "https://example.com/x/y.git"], {
        cwd: repo,
        env,
        input,
        encoding: "utf8",
      });
    const blocked = run(line("refs/heads/main", head()));
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("pnpm validate");
    stamp(repo);
    expect(run(line("refs/heads/main", head())).status).toBe(0);
  });
});
