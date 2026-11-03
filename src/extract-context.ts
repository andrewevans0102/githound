import { Octokit } from "@octokit/rest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ReviewContext } from "./types.js";

export async function extractReviewContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commentBody: string,
  filePath?: string,
  line?: number,
  cwd = process.cwd()
): Promise<ReviewContext> {
  // Fetch PR metadata
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  // Fetch only the PR diff (compact view)
  let diffData = "";
  try {
    const res = await octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: {
        format: "diff",
      },
    });
    diffData = String(res.data);
  } catch (err) {
    console.warn(`Could not fetch PR diff via Octokit:`, err);
    try {
      diffData = execSync(`git diff origin/main...HEAD`, { cwd, encoding: "utf-8" });
    } catch {
      diffData = "";
    }
  }

  let lineSnippet = "";
  let fullFileContent: string | undefined = undefined;

  if (filePath) {
    try {
      let fileContent = "";
      try {
        fileContent = execSync(`git show origin/${pr.head.ref}:${filePath}`, {
          cwd,
          encoding: "utf-8",
        });
      } catch {
        fileContent = execSync(`git show HEAD:${filePath}`, {
          cwd,
          encoding: "utf-8",
        });
      }

      fullFileContent = fileContent;

      if (line) {
        const lines = fileContent.split("\n");
        const start = Math.max(0, line - 10);
        const end = Math.min(lines.length, line + 10);
        lineSnippet = lines
          .slice(start, end)
          .map((l, idx) => `${start + idx + 1}: ${l}`)
          .join("\n");
      }
    } catch (err) {
      console.warn(`Could not extract local snippet for ${filePath}:`, err);
    }
  }

  return {
    prNumber: pullNumber,
    branchName: pr.head.ref,
    diff: diffData,
    commentPath: filePath,
    commentBody,
    lineSnippet,
    fullFileContent,
  };
}

const BINARY_OR_IGNORED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
  ".pdf", ".zip", ".tar", ".gz", ".tgz", ".lock", ".bin",
  ".exe", ".dylib", ".so", ".wasm", ".map", ".mp3", ".mp4"
]);

const IGNORED_FILENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".DS_Store"
]);

/**
 * Extracts key repository context (tracked file tree and readable source/test contents)
 * to give LLMs full awareness of project structure, existing exports, and test suites.
 */
export function extractRepoContext(
  cwd = process.cwd(),
  options: { maxFileSize?: number; maxTotalSize?: number } = {}
): string {
  const maxFileSize = options.maxFileSize ?? 50 * 1024; // 50 KB
  const maxTotalSize = options.maxTotalSize ?? 200 * 1024; // 200 KB

  let files: string[] = [];
  try {
    files = execSync("git ls-files", { cwd, encoding: "utf-8" })
      .trim()
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return "";
  }

  if (files.length === 0) {
    return "";
  }

  let totalBytes = 0;
  const fileSections: string[] = [];

  for (const relPath of files) {
    const ext = path.extname(relPath).toLowerCase();
    const basename = path.basename(relPath);

    if (BINARY_OR_IGNORED_EXTENSIONS.has(ext) || IGNORED_FILENAMES.has(basename)) {
      continue;
    }

    const fullPath = path.resolve(cwd, relPath);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > maxFileSize) {
        continue;
      }
      if (totalBytes + stat.size > maxTotalSize) {
        break;
      }
      const content = fs.readFileSync(fullPath, "utf-8");
      if (content.includes("\0")) {
        continue; // Skip binary files that had unexpected extensions
      }
      totalBytes += stat.size;
      fileSections.push(`--- File: ${relPath} ---\n${content}`);
    } catch {
      // Ignore read errors
    }
  }

  const output: string[] = [
    "### Tracked Repository Files:",
    ...files.map((f) => `- ${f}`),
    "",
    "### Existing File Contents:",
    ...fileSections,
  ];

  return output.join("\n");
}

/**
 * Inspects deterministic failure output (test logs, compiler traces)
 * and retrieves the on-disk content of any mentioned repository files (e.g. failing test files).
 */
export function extractFailureRelatedFiles(
  failureOutput: string,
  cwd = process.cwd()
): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const visited = new Set<string>();

  let trackedFiles: string[] = [];
  try {
    trackedFiles = execSync("git ls-files", { cwd, encoding: "utf-8" })
      .trim()
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return results;
  }

  // Look for exact matches of tracked files inside failure output
  for (const relPath of trackedFiles) {
    if (failureOutput.includes(relPath)) {
      const fullPath = path.resolve(cwd, relPath);
      if (!visited.has(relPath) && fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (!content.includes("\0")) {
            visited.add(relPath);
            results.push({ path: relPath, content });
          }
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  return results;
}
