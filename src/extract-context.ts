import { Octokit } from "@octokit/rest";
import { execSync } from "node:child_process";
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
  if (filePath && line) {
    try {
      // Pull only the surrounding lines around the comment
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

      const lines = fileContent.split("\n");
      const start = Math.max(0, line - 10);
      const end = Math.min(lines.length, line + 10);
      lineSnippet = lines
        .slice(start, end)
        .map((l, idx) => `${start + idx + 1}: ${l}`)
        .join("\n");
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
  };
}
