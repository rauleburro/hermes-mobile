import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "../../../scripts/git.mjs";
import { ALLOW_MARKER, formatHit, scanPath, scanRepo, scanText } from "../../../scripts/hygiene.mjs";

const SCRIPT = resolve(import.meta.dirname, "../../../scripts/hygiene.mjs");

// Fixtures are assembled from pieces so this file does not trip the scanner
// (or the workspace-level grep) on its own source.
const MAC = "/Us" + "ers/";
const LIN = "/ho" + "me/";
const WIN = "C:\\Us" + "ers\\";
const KEY_BEGIN = "-----BEGIN " + "RSA PRIVATE KEY-----";

function rules(text: string, file = "a.txt"): string[] {
  return scanText(file, text).map((h: { rule: string }) => h.rule);
}

describe("scanText: home-directory paths", () => {
  it("flags a macOS home path", () => {
    expect(rules(`open ${MAC}alice/project`)).toEqual(["home-path"]);
  });

  it("flags a Linux home path", () => {
    expect(rules(`cd ${LIN}alice/src`)).toEqual(["home-path"]);
  });

  it("flags a Windows home path, with either slash style", () => {
    expect(rules(`${WIN}alice\\Desktop`)).toEqual(["home-path"]);
    expect(rules("C:/Us" + "ers/alice/Desktop")).toEqual(["home-path"]);
  });

  it("flags a WSL path into a Windows home", () => {
    expect(rules(`cd /mnt/c${MAC}alice/project`)).toEqual(["home-path"]);
    expect(rules(`/mnt/d${MAC}alice`)).toEqual(["home-path"]);
  });

  it("does not flag WSL placeholders or shared directories", () => {
    expect(rules(`/mnt/c${MAC}<name>/project`)).toEqual([]);
    expect(rules(`/mnt/c${MAC}Public/x`)).toEqual([]);
  });

  it("flags a path that ends right after the user name", () => {
    expect(rules(`HOME=${MAC}alice`)).toEqual(["home-path"]);
  });

  it("flags a file:// URL to a home path", () => {
    expect(rules(`file://${MAC}alice/x.png`)).toEqual(["home-path"]);
  });

  it("does not flag placeholders, ellipses or angle-bracket names", () => {
    expect(rules(`never commit ${MAC}...`)).toEqual([]);
    expect(rules(`${MAC}<name>/project`)).toEqual([]);
    expect(rules(`${MAC}$USER/project`)).toEqual([]);
  });

  it("does not flag shared system directories", () => {
    expect(rules(`${MAC}Shared/x`)).toEqual([]);
    expect(rules(`${WIN}Public\\x`)).toEqual([]);
    expect(rules(`${LIN}runner/work`)).toEqual([]);
  });

  it("does not flag URL or relative route segments that merely contain the word", () => {
    expect(rules(`https://example.com${LIN}alice/list`)).toEqual([]);
    expect(rules(`import x from "..${LIN}alice/x"`)).toEqual([]);
    expect(rules(`src${LIN}alice/x`)).toEqual([]);
  });
});

describe("scanText: private keys", () => {
  it("flags a private key block header", () => {
    expect(rules(KEY_BEGIN)).toEqual(["private-key"]);
    expect(rules("-----BEGIN " + "OPENSSH PRIVATE KEY-----")).toEqual(["private-key"]);
    expect(rules("-----BEGIN " + "PRIVATE KEY-----")).toEqual(["private-key"]);
  });

  it("does not flag a public key or certificate", () => {
    expect(rules("-----BEGIN " + "PUBLIC KEY-----")).toEqual([]);
    expect(rules("-----BEGIN " + "CERTIFICATE-----")).toEqual([]);
  });
});

describe("scanText: token shapes", () => {
  it("flags GitHub tokens", () => {
    expect(rules("token=ghp" + "_" + "a1B2".repeat(9))).toEqual(["token"]);
    expect(rules("github" + "_pat_" + "A1b2C3".repeat(5))).toEqual(["token"]);
  });

  it("flags AWS access key ids", () => {
    expect(rules("key AKIA" + "ABCDEFGHIJKLMNOP")).toEqual(["token"]);
  });

  it("does not flag short or lookalike strings", () => {
    expect(rules("ghp" + "_short")).toEqual([]);
    expect(rules("AKIA" + "SHORT")).toEqual([]);
    expect(rules("a plain sentence about tokens")).toEqual([]);
  });
});

describe("scanText: allow marker and positions", () => {
  it("skips a line carrying the allow marker", () => {
    expect(rules(`never commit ${MAC}alice/ <!-- ${ALLOW_MARKER} -->`)).toEqual([]);
  });

  it("allows only the marked line", () => {
    const text = `ok ${MAC}alice/ # ${ALLOW_MARKER}\nbad ${MAC}bob/\n`;
    expect(scanText("a.txt", text)).toEqual([{ file: "a.txt", line: 2, rule: "home-path" }]);
  });

  it("reports one hit per rule per line and the 1-based line number", () => {
    const text = `fine\n${MAC}alice/ ${LIN}bob/\n`;
    expect(scanText("a.txt", text)).toEqual([{ file: "a.txt", line: 2, rule: "home-path" }]);
  });

  it("does not echo the matched text when formatting a hit", () => {
    const [hit] = scanText("src/a.ts", `\n${KEY_BEGIN}`);
    expect(formatHit(hit)).toMatch(/^src\/a\.ts:2: private-key/);
    expect(formatHit(hit)).not.toContain("RSA");
  });
});

describe("scanPath: tracked env files", () => {
  it("flags .env and .env.<name> at any depth", () => {
    expect(scanPath(".env")).toEqual([{ file: ".env", line: 0, rule: "env-file" }]);
    expect(scanPath("services/bff/.env.local").map((h: { rule: string }) => h.rule)).toEqual(["env-file"]);
  });

  it("allows example files and look-alikes", () => {
    expect(scanPath(".env.example")).toEqual([]);
    expect(scanPath("services/bff/.env.example")).toEqual([]);
    expect(scanPath("src/environment.ts")).toEqual([]);
    expect(scanPath("docs/dotenv.md")).toEqual([]);
  });

  it("formats path hits without a line number", () => {
    expect(formatHit({ file: ".env", line: 0, rule: "env-file" })).toMatch(/^\.env: env-file/);
  });
});

describe("scanRepo / CLI (throwaway git repo)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hygiene-"));
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@example.com"]);
    git(dir, ["config", "user.name", "T"]);
    git(dir, ["config", "commit.gpgsign", "false"]);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function track(name: string, content: string | Buffer) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
    git(dir, ["add", name]);
  }

  function cli() {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
    return spawnSync("node", [SCRIPT], { cwd: dir, env, encoding: "utf8" });
  }

  it("passes a clean repo with exit 0", () => {
    track("a.txt", "hello\n");
    expect(scanRepo(dir)).toEqual([]);
    expect(cli().status).toBe(0);
  });

  it("reports a tracked leak as file:line and exits 1", () => {
    track("notes/a.txt", `one\ntwo ${MAC}alice/x\n`);
    expect(scanRepo(dir)).toEqual([{ file: "notes/a.txt", line: 2, rule: "home-path" }]);
    const res = cli();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("notes/a.txt:2: home-path");
    expect(res.stderr).not.toContain("alice");
  });

  it("ignores an untracked file", () => {
    track("a.txt", "hello\n");
    writeFileSync(join(dir, "leak.txt"), `${MAC}alice/x\n`);
    expect(scanRepo(dir)).toEqual([]);
    expect(cli().status).toBe(0);
  });

  it("flags a tracked .env file but not .env.example", () => {
    track(".env", "X=1\n");
    track(".env.example", "X=\n");
    expect(scanRepo(dir)).toEqual([{ file: ".env", line: 0, rule: "env-file" }]);
    expect(cli().status).toBe(1);
  });

  it("skips binary files and the lockfile", () => {
    track("img.bin", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`${MAC}alice/x`)]));
    track("pnpm-lock.yaml", `${MAC}alice/x\n`);
    expect(scanRepo(dir)).toEqual([]);
  });

  it("does not crash on a tracked file deleted from the working tree", () => {
    track("gone.txt", "bye\n");
    rmSync(join(dir, "gone.txt"));
    expect(scanRepo(dir)).toEqual([]);
    expect(cli().status).toBe(0);
  });

  it("scans paths with spaces and non-ascii names", () => {
    track("dir with space/é.txt", `${MAC}alice/x\n`);
    expect(scanRepo(dir)).toEqual([{ file: "dir with space/é.txt", line: 1, rule: "home-path" }]);
  });
});
