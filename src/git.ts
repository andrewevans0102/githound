import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { FileEdit } from "./types.js";

export class GitManager {
  constructor(private cwd: string = process.cwd()) {}

  private exec(cmd: string): string {
    return execSync(cmd, { cwd: this.cwd, encoding: "utf-8" }).trim();
  }

  getCurrentBranch(): string {
    return this.exec("git rev-parse --abbrev-ref HEAD");
  }

  checkoutBranch(branchName: string, createIfMissing = true): void {
    try {
      this.exec(`git checkout ${branchName}`);
    } catch {
      if (createIfMissing) {
        this.exec(`git checkout -b ${branchName}`);
      } else {
        throw new Error(`Branch ${branchName} not found and createIfMissing is false`);
      }
    }
  }

  hasChanges(): boolean {
    const status = this.exec("git status --porcelain");
    return status.length > 0;
  }

  commitAll(
    message: string,
    authorName = "githound[bot]",
    authorEmail = "githound[bot]@users.noreply.github.com"
  ): string {
    this.exec(`git config user.name "${authorName}"`);
    this.exec(`git config user.email "${authorEmail}"`);
    this.exec("git add -A");
    this.exec(`git commit -m "${message.replace(/"/g, '\\"')}"`);
    return this.exec("git rev-parse HEAD");
  }

  pushBranch(branchName: string, remote = "origin", force = false): void {
    const forceFlag = force ? " --force" : "";
    this.exec(`git push${forceFlag} -u ${remote} ${branchName}`);
  }

  getDiff(baseRef = "origin/main"): string {
    try {
      return this.exec(`git diff ${baseRef}`);
    } catch {
      return this.exec("git diff HEAD~1");
    }
  }

  getFileAtRef(ref: string, filePath: string): string | null {
    try {
      return this.exec(`git show ${ref}:${filePath}`);
    } catch {
      return null;
    }
  }

  getLatestCommitHash(): string {
    return this.exec("git rev-parse HEAD");
  }

  applyFileEdits(edits: FileEdit[]): string[] {
    const modifiedFiles: string[] = [];
    for (const edit of edits) {
      const fullPath = path.resolve(this.cwd, edit.path);
      if (edit.action === "delete") {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          modifiedFiles.push(edit.path);
        }
      } else {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, edit.content, "utf-8");
        modifiedFiles.push(edit.path);
      }
    }
    return modifiedFiles;
  }
}
