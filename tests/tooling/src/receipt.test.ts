import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRAILER_KEY, check, readTrailer, stamp } from "../../../scripts/receipt.mjs";

const SCRIPT = resolve(import.meta.dirname, "../../../scripts/receipt.mjs");

function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  return execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
}

function commitFile(cwd: string, name: string, content: string, msg: string) {
  writeFileSync(join(cwd, name), content);
  git(cwd, "add", name);
  git(cwd, "commit", "-q", "-m", msg);
}

function cli(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  return spawnSync("node", [SCRIPT, ...args], { cwd, env, encoding: "utf8" });
}

const SHA = "a".repeat(40);

describe("readTrailer", () => {
  it("returns no values when the message has no trailer", () => {
    expect(readTrailer("subject\n\nbody\n")).toEqual([]);
  });

  it("reads the trailer from the final paragraph", () => {
    expect(readTrailer(`subject\n\nbody\n\n${TRAILER_KEY}: ${SHA}\n`)).toEqual([SHA]);
  });

  it("reads it next to other trailers", () => {
    const msg = `subject\n\nCo-Authored-By: A <a@example.com>\n${TRAILER_KEY}: ${SHA}\n`;
    expect(readTrailer(msg)).toEqual([SHA]);
  });

  it("ignores the key when it is not in the trailer block", () => {
    expect(readTrailer(`subject\n\n${TRAILER_KEY}: ${SHA}\n\nmore body\n`)).toEqual([]);
  });

  it("ignores the key in the subject-only paragraph", () => {
    expect(readTrailer(`${TRAILER_KEY}: ${SHA}\n`)).toEqual([]);
  });

  it("returns every value when the key repeats", () => {
    const other = "b".repeat(40);
    const msg = `subject\n\n${TRAILER_KEY}: ${SHA}\n${TRAILER_KEY}: ${other}\n`;
    expect(readTrailer(msg)).toEqual([SHA, other]);
  });
});

describe("receipt in a throwaway repo", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "receipt-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "commit.gpgsign", "false");
    commitFile(repo, "a.txt", "one\n", "first");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("check passes after stamp", () => {
    stamp(repo);
    expect(check(repo).ok).toBe(true);
  });

  it("stamp leaves the tree, author and subject unchanged", () => {
    const tree = git(repo, "rev-parse", "HEAD^{tree}");
    const author = git(repo, "log", "-1", "--format=%an <%ae> %aI");
    stamp(repo);
    expect(git(repo, "rev-parse", "HEAD^{tree}")).toBe(tree);
    expect(git(repo, "log", "-1", "--format=%an <%ae> %aI")).toBe(author);
    expect(git(repo, "log", "-1", "--format=%s")).toBe("first");
    expect(git(repo, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(repo, "log", "-1", "--format=%B")).toContain(`${TRAILER_KEY}: ${tree}`);
  });

  it("stamp twice keeps exactly one trailer", () => {
    stamp(repo);
    stamp(repo);
    const body = git(repo, "log", "-1", "--format=%B");
    expect(body.split("\n").filter((l) => l.startsWith(`${TRAILER_KEY}:`))).toHaveLength(1);
    expect(check(repo).ok).toBe(true);
  });

  it("stamp replaces a stale trailer after the tree changes", () => {
    stamp(repo);
    writeFileSync(join(repo, "a.txt"), "two\n");
    git(repo, "commit", "-q", "-a", "--amend", "--no-edit");
    expect(check(repo).ok).toBe(false);
    stamp(repo);
    expect(check(repo).ok).toBe(true);
    const body = git(repo, "log", "-1", "--format=%B");
    expect(body.split("\n").filter((l) => l.startsWith(`${TRAILER_KEY}:`))).toHaveLength(1);
  });

  it("stamp preserves the existing message body and other trailers verbatim", () => {
    git(repo, "commit", "-q", "--allow-empty", "-m", "subject\n\n# not a comment\nbody line\n\nCo-Authored-By: A <a@example.com>");
    stamp(repo);
    const body = git(repo, "log", "-1", "--format=%B");
    expect(body).toContain("# not a comment");
    expect(body).toContain("body line");
    expect(body).toContain("Co-Authored-By: A <a@example.com>");
    expect(check(repo).ok).toBe(true);
  });

  it("stamp then check agree when the message has a standalone --- paragraph", () => {
    git(repo, "commit", "-q", "--allow-empty", "-m", "subject\n\nbody\n\n---\n\nfooter prose");
    stamp(repo);
    expect(check(repo).ok).toBe(true);
  });

  it("stamp throws when its own receipt does not check (writer and reader must agree)", () => {
    // Repo trailer config can make interpret-trailers write nothing at all.
    git(repo, "config", "trailer.ifmissing", "doNothing");
    expect(() => stamp(repo)).toThrow(/receipt|check/i);
  });

  it("a new commit after stamp is not validated", () => {
    stamp(repo);
    commitFile(repo, "b.txt", "x\n", "later");
    const r = check(repo);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("pnpm validate");
  });

  it("check fails for an amended tree that keeps the old trailer", () => {
    stamp(repo);
    writeFileSync(join(repo, "a.txt"), "changed\n");
    git(repo, "commit", "-q", "-a", "--amend", "--no-edit");
    const r = check(repo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/stale|does not match/i);
    expect(r.message).toContain("pnpm validate");
  });

  it("check fails with guidance when there is no trailer", () => {
    const r = check(repo);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("pnpm validate");
    expect(r.message).toMatch(/no .*Validated-tree/i);
  });

  it("check fails on a malformed value", () => {
    git(repo, "commit", "-q", "--amend", "-m", `first\n\n${TRAILER_KEY}: not-a-hash`);
    const r = check(repo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/malformed/i);
  });

  it("check fails when the trailer is repeated, even if one matches", () => {
    const tree = git(repo, "rev-parse", "HEAD^{tree}");
    git(repo, "commit", "-q", "--amend", "-m", `first\n\n${TRAILER_KEY}: ${SHA}\n${TRAILER_KEY}: ${tree}`);
    const r = check(repo);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/multiple/i);
  });

  it("check accepts a commit-ish other than HEAD", () => {
    stamp(repo);
    const stamped = git(repo, "rev-parse", "HEAD");
    commitFile(repo, "b.txt", "x\n", "later");
    expect(check(repo, stamped).ok).toBe(true);
    expect(check(repo, "HEAD").ok).toBe(false);
  });

  it("stamp refuses with unstaged changes to tracked files", () => {
    writeFileSync(join(repo, "a.txt"), "dirty\n");
    expect(() => stamp(repo)).toThrow(/uncommitted|changes/i);
  });

  it("stamp refuses with staged changes", () => {
    writeFileSync(join(repo, "a.txt"), "staged\n");
    git(repo, "add", "a.txt");
    expect(() => stamp(repo)).toThrow(/uncommitted|changes/i);
  });

  it("stamp ignores untracked files", () => {
    writeFileSync(join(repo, "untracked.txt"), "x\n");
    stamp(repo);
    expect(check(repo).ok).toBe(true);
  });

  it("stamp does not run commit hooks", () => {
    const hook = join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const commitMsg = join(repo, ".git", "hooks", "commit-msg");
    writeFileSync(commitMsg, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    stamp(repo);
    expect(check(repo).ok).toBe(true);
  });

  describe("CLI", () => {
    it("stamp then check exit 0", () => {
      const s = cli(repo, "stamp");
      expect(s.status).toBe(0);
      const c = cli(repo, "check");
      expect(c.status).toBe(0);
      expect(c.stdout).toMatch(/ok/i);
    });

    it("check exits 1 with guidance on stderr when unstamped", () => {
      const c = cli(repo, "check");
      expect(c.status).toBe(1);
      expect(c.stderr).toContain("pnpm validate");
    });

    it("check takes an explicit commit-ish", () => {
      cli(repo, "stamp");
      const stamped = git(repo, "rev-parse", "HEAD");
      commitFile(repo, "b.txt", "x\n", "later");
      expect(cli(repo, "check", stamped).status).toBe(0);
      expect(cli(repo, "check").status).toBe(1);
    });

    it("stamp exits 1 on a dirty tree", () => {
      writeFileSync(join(repo, "a.txt"), "dirty\n");
      const s = cli(repo, "stamp");
      expect(s.status).toBe(1);
      expect(s.stderr).toMatch(/uncommitted|changes/i);
    });

    it("unknown command exits 2 with usage", () => {
      const r = cli(repo, "bogus");
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/usage/i);
    });
  });
});
