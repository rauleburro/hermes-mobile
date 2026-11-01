import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "../../../scripts/git.mjs";
import { check } from "../../../scripts/receipt.mjs";
import { DEFAULT_STEPS, runValidate } from "../../../scripts/validate.mjs";

// These tests only ever touch throwaway repos: runValidate is given injected
// steps, never the real `pnpm test` (that would recurse into this suite).

describe("runValidate in a throwaway repo", () => {
  let repo: string;
  let out: string; // scratch dir outside the repo, so markers do not dirty it

  const marker = (name: string) => join(out, name);
  /** A step that appends its name to a log file, then exits with `code`. */
  const step = (name: string, code = 0) => ({
    name,
    command: process.execPath,
    args: [
      "-e",
      `require("fs").appendFileSync(${JSON.stringify(marker("log"))}, ${JSON.stringify(name + "\n")}); process.exit(${code})`,
    ],
  });
  const ran = () => (existsSync(marker("log")) ? readFileSync(marker("log"), "utf8").split("\n").filter(Boolean) : []);
  const run = (steps: ReturnType<typeof step>[]) => runValidate({ cwd: repo, steps, stdio: "ignore", log: () => {} });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "validate-"));
    out = mkdtempSync(join(tmpdir(), "validate-out-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.name", "Test"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "a.txt"), "one\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "-m", "first"]);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it("runs the steps in order and then stamps HEAD", () => {
    const result = run([step("one"), step("two")]);
    expect(result.ok).toBe(true);
    expect(ran()).toEqual(["one", "two"]);
    expect(check(repo).ok).toBe(true);
  });

  it("fails fast on a dirty tree: no step runs and nothing is stamped", () => {
    writeFileSync(join(repo, "a.txt"), "changed\n");
    const result = run([step("one")]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/commit/i);
    expect(ran()).toEqual([]);
    expect(check(repo).ok).toBe(false);
  });

  it("fails fast on staged changes too", () => {
    writeFileSync(join(repo, "a.txt"), "changed\n");
    git(repo, ["add", "a.txt"]);
    expect(run([step("one")]).ok).toBe(false);
    expect(ran()).toEqual([]);
  });

  it("ignores untracked files", () => {
    writeFileSync(join(repo, "scratch.txt"), "x\n");
    expect(run([step("one")]).ok).toBe(true);
  });

  it("stops at the first failing step: later steps skipped, no stamp, message unchanged", () => {
    const before = git(repo, ["rev-parse", "HEAD"]);
    const result = run([step("one"), step("two", 3), step("three")]);
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("two");
    expect(ran()).toEqual(["one", "two"]);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(before);
    expect(check(repo).ok).toBe(false);
  });

  it("fails when a step cannot be started", () => {
    const result = run([{ name: "missing", command: "definitely-not-a-command-xyz", args: [] }]);
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("missing");
  });

  it("does not stamp if a step dirtied tracked files", () => {
    const dirtying = {
      name: "dirty",
      command: process.execPath,
      args: ["-e", `require("fs").writeFileSync(${JSON.stringify(join(repo, "a.txt"))}, "mutated\\n")`],
    };
    const result = run([dirtying]);
    expect(result.ok).toBe(false);
    expect(check(repo).ok).toBe(false);
  });

  it("does not stamp if HEAD moved to a different tree during the steps", () => {
    const committing = {
      name: "commit-elsewhere",
      command: "sh",
      args: ["-c", "echo x > b.txt && git add b.txt && git commit -q -m moved"],
    };
    const result = run([committing]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/HEAD changed/);
    expect(result.message).toContain("pnpm validate");
    expect(git(repo, ["log", "-1", "--format=%s"]).trim()).toBe("moved");
    expect(check(repo).ok).toBe(false);
  });
});

describe("DEFAULT_STEPS", () => {
  it("runs test, typecheck, lint, hygiene in that order", () => {
    expect(DEFAULT_STEPS.map((s: { name: string }) => s.name)).toEqual(["test", "typecheck", "lint", "hygiene"]);
  });
});
