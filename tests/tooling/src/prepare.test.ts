import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "../../../scripts/git.mjs";
import { hookInstallPlan, installHooks } from "../../../scripts/prepare.mjs";

const SCRIPT = resolve(import.meta.dirname, "../../../scripts/prepare.mjs");

describe("hookInstallPlan", () => {
  let repo: string;
  let plain: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "prepare-repo-"));
    plain = mkdtempSync(join(tmpdir(), "prepare-plain-"));
    git(repo, ["init", "-q"]);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  });

  it("installs hooks in a git checkout on a developer machine", () => {
    expect(hookInstallPlan(repo, {}).install).toBe(true);
  });

  it("skips outside a git repository (tarball, Docker build)", () => {
    const plan = hookInstallPlan(plain, {});
    expect(plan.install).toBe(false);
    expect(plan.reason).toMatch(/git/i);
  });

  it("skips in CI", () => {
    expect(hookInstallPlan(repo, { CI: "true" }).install).toBe(false);
    expect(hookInstallPlan(repo, { CI: "1" }).install).toBe(false);
  });

  it("does not treat CI=false or empty as CI", () => {
    expect(hookInstallPlan(repo, { CI: "false" }).install).toBe(true);
    expect(hookInstallPlan(repo, { CI: "" }).install).toBe(true);
  });

  it("skips when hooks are disabled with LEFTHOOK=0", () => {
    expect(hookInstallPlan(repo, { LEFTHOOK: "0" }).install).toBe(false);
  });

  const cleanEnv = (extra: Record<string, string> = {}) => {
    const env: Record<string, string | undefined> = { ...process.env, ...extra };
    for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
    if (!("CI" in extra)) delete env.CI;
    return env;
  };

  it("CLI exits 0 without touching anything when it skips", () => {
    const res = spawnSync("node", [SCRIPT], { cwd: repo, env: cleanEnv({ CI: "true" }), encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/skip/i);
  });

  it("CLI exits 0 outside a git repository", () => {
    const res = spawnSync("node", [SCRIPT], { cwd: plain, env: cleanEnv(), encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/skip/i);
  });
});

describe("installHooks", () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, warn: (line: string) => lines.push(line) };
  };

  it("returns 0 silently when lefthook install succeeds", () => {
    const { lines, warn } = capture();
    const calls: [string, string[]][] = [];
    const spawn = (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      return { status: 0 };
    };
    expect(installHooks({ spawn, warn })).toBe(0);
    expect(calls).toEqual([["lefthook", ["install"]]]);
    expect(lines).toEqual([]);
  });

  it("warns with manual guidance and returns 0 when lefthook install exits non-zero", () => {
    const { lines, warn } = capture();
    expect(installHooks({ spawn: () => ({ status: 1 }), warn })).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("npx lefthook install");
    expect(text).toContain("core.hooksPath");
  });

  it("warns and returns 0 when lefthook cannot be started (not installed)", () => {
    const { lines, warn } = capture();
    const error = Object.assign(new Error("spawn lefthook ENOENT"), { code: "ENOENT" });
    expect(installHooks({ spawn: () => ({ status: null, error }), warn })).toBe(0);
    expect(lines.join("\n")).toContain("npx lefthook install");
  });
});
