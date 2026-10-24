import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { GitManager } from "../src/git.js";

describe("GitManager", () => {
  let tempDir: string;
  let git: GitManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "githound-test-"));
    execSync("git init", { cwd: tempDir });
    execSync('git config user.name "test-user"', { cwd: tempDir });
    execSync('git config user.email "test@example.com"', { cwd: tempDir });
    git = new GitManager(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("applies file creations and updates", () => {
    const edits = [
      { path: "src/math.ts", content: "export const add = (a: number, b: number) => a + b;", action: "create" as const },
      { path: "docs/readme.txt", content: "hello world", action: "create" as const },
    ];

    const modified = git.applyFileEdits(edits);
    expect(modified).toEqual(["src/math.ts", "docs/readme.txt"]);

    expect(fs.existsSync(path.join(tempDir, "src/math.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, "src/math.ts"), "utf-8")).toContain("export const add");
    expect(git.hasChanges()).toBe(true);
  });

  it("commits all changes", () => {
    git.applyFileEdits([
      { path: "test.txt", content: "initial", action: "create" },
    ]);
    const hash = git.commitAll("initial commit");
    expect(hash).toHaveLength(40);
    expect(git.hasChanges()).toBe(false);
  });

  it("checks out existing or new branches", () => {
    git.applyFileEdits([{ path: "test.txt", content: "init", action: "create" }]);
    git.commitAll("init");

    git.checkoutBranch("feature-hound", true);
    expect(git.getCurrentBranch()).toBe("feature-hound");
  });

  it("applies file deletion", () => {
    git.applyFileEdits([{ path: "temp.txt", content: "delete me", action: "create" }]);
    expect(fs.existsSync(path.join(tempDir, "temp.txt"))).toBe(true);

    git.applyFileEdits([{ path: "temp.txt", content: "", action: "delete" }]);
    expect(fs.existsSync(path.join(tempDir, "temp.txt"))).toBe(false);
  });
});
