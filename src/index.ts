#!/usr/bin/env node

import { Octokit } from "@octokit/rest";
import { Command } from "commander";
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import { HARVEY_ASCII } from "./ascii.js";
import { extractReviewContext } from "./extract-context.js";
import { handleIssueIntake } from "./handle-issue.js";
import { handlePrRevision } from "./handle-revision.js";
import { VerificationRunner } from "./runner.js";
import type { GitHoundConfig } from "./types.js";

dotenv.config();

export function getConfig(): GitHoundConfig {
  const repoFull = process.env.GITHUB_REPOSITORY || "owner/githound";
  const [owner, repo] = repoFull.split("/");

  return {
    owner: owner || "owner",
    repo: repo || "githound",
    maxRetries: Number(process.env.GITHOUND_MAX_RETRIES || 3),
    testCommand: process.env.GITHOUND_TEST_CMD || "npm test",
    typecheckCommand: process.env.GITHOUND_TYPECHECK_CMD || "npm run typecheck",
    model: process.env.GEMINI_MODEL || process.env.GITHOUND_MODEL || "gemini-2.5-flash",
    botName: process.env.GITHOUND_BOT_NAME || "githound[bot]",
    botEmail: process.env.GITHOUND_BOT_EMAIL || "githound[bot]@users.noreply.github.com",
    baseBranch: process.env.GITHOUND_BASE_BRANCH || "main",
  };
}

export function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn("⚠️ GITHUB_TOKEN not found in environment. GitHub API calls may fail or be rate limited.");
  }
  return new Octokit({ auth: token });
}

export function isOwner(
  login?: string,
  authorAssociation?: string,
  expectedOwner?: string
): boolean {
  if (authorAssociation === "OWNER") {
    return true;
  }
  if (expectedOwner && login && login.toLowerCase() === expectedOwner.toLowerCase()) {
    return true;
  }
  return false;
}

export async function runGitHubAction(options?: {
  event?: any;
  eventName?: string;
  config?: GitHoundConfig;
  octokit?: Octokit;
}): Promise<void> {
  let event: any;
  const eventName = options?.eventName ?? process.env.GITHUB_EVENT_NAME ?? "";

  if (options?.event) {
    event = options.event;
  } else {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath || !fs.existsSync(eventPath)) {
      throw new Error(`GITHUB_EVENT_PATH is not set or file does not exist: ${eventPath}`);
    }
    const raw = fs.readFileSync(eventPath, "utf-8");
    event = JSON.parse(raw);
  }

  const config = options?.config ?? getConfig();
  const octokit = options?.octokit ?? getOctokit();

  console.log(HARVEY_ASCII);
  console.log(`🐾 Running GitHound for event: ${eventName}`);

  if (eventName === "issues" && event.action === "labeled") {
    if (event.label?.name !== "githound") {
      console.log(`Issue label "${event.label?.name}" is not "githound". Skipping.`);
      return;
    }

    const issueAuthor = event.issue?.user?.login;
    const issueAssoc = event.issue?.author_association;
    if (!isOwner(issueAuthor, issueAssoc, config.owner)) {
      console.warn(`Unauthorized: Issue #${event.issue?.number} was opened by non-owner "${issueAuthor}". Skipping.`);
      return;
    }

    const senderLogin = event.sender?.login;
    const senderAssoc = event.sender?.author_association;
    if (!isOwner(senderLogin, senderAssoc, config.owner)) {
      console.warn(`Unauthorized: Label "githound" was applied by non-owner "${senderLogin}". Skipping.`);
      return;
    }

    const issueContext = {
      issueNumber: event.issue.number,
      title: event.issue.title,
      body: event.issue.body || "",
      branchName: `githound/issue-${event.issue.number}`,
      labels: (event.issue.labels || []).map((l: any) => l.name),
    };

    await handleIssueIntake({
      octokit,
      config,
      issue: issueContext,
    });
    return;
  }

  const isIssueComment = eventName === "issue_comment" && event.action === "created";
  const isPrReviewComment = eventName === "pull_request_review_comment" && event.action === "created";

  if (isIssueComment || isPrReviewComment) {
    const commentBody = (event.comment?.body || "").trim();
    if (!commentBody.startsWith("/hound")) {
      console.log("Comment does not start with /hound. Skipping.");
      return;
    }

    const commenterLogin = event.comment?.user?.login || event.sender?.login;
    const commenterAssoc = event.comment?.author_association || event.sender?.author_association;
    if (!isOwner(commenterLogin, commenterAssoc, config.owner)) {
      console.warn(`Unauthorized: /hound command invoked by non-owner "${commenterLogin}". Skipping.`);
      return;
    }

    const prNumber = event.issue?.number || event.pull_request?.number;
    if (!prNumber) {
      console.warn("Could not determine PR number from event payload.");
      return;
    }

    const filePath = event.comment?.path;
    const line = event.comment?.line || event.comment?.original_line;

    const ctx = await extractReviewContext(
      octokit,
      config.owner,
      config.repo,
      prNumber,
      commentBody,
      filePath,
      line
    );

    await handlePrRevision({
      ctx,
      octokit,
      config,
      commentId: event.comment?.id,
    });
    return;
  }

  console.log(`Event ${eventName} is not handled by GitHound.`);
}

export function createCli(): Command {
  const program = new Command();

  program
    .name("githound")
    .description("Git-Driven Human-in-the-Loop harness for safer coding agents")
    .version("1.0.0");

  program
    .command("action")
    .description("Run GitHound inside GitHub Actions based on GITHUB_EVENT_PATH")
    .action(async () => {
      await runGitHubAction();
    });

  program
    .command("verify")
    .description("Run the deterministic verification gate locally (typecheck + test)")
    .action(async () => {
      const config = getConfig();
      const runner = new VerificationRunner();
      const commands = [config.typecheckCommand, config.testCommand].filter(Boolean) as string[];
      console.log(`Running verification commands: ${commands.join(", ")}`);
      const result = await runner.runVerificationGate(commands);
      if (result.passed) {
        console.log("✅ Verification gate passed!");
      } else {
        console.error("❌ Verification gate failed:\n" + result.failureSummary);
        process.exit(1);
      }
    });

  program
    .command("handle-issue")
    .description("Manually trigger issue intake workflow")
    .requiredOption("-n, --number <number>", "Issue number", parseInt)
    .requiredOption("-t, --title <title>", "Issue title")
    .option("-b, --body <body>", "Issue body", "")
    .action(async (opts) => {
      const config = getConfig();
      const octokit = getOctokit();
      await handleIssueIntake({
        octokit,
        config,
        issue: {
          issueNumber: opts.number,
          title: opts.title,
          body: opts.body,
          branchName: `githound/issue-${opts.number}`,
          labels: ["githound"],
        },
      });
    });

  program
    .command("handle-review")
    .description("Manually trigger PR review feedback revision")
    .requiredOption("-p, --pr <number>", "PR number", parseInt)
    .requiredOption("-c, --comment <comment>", "Review comment text (e.g. /hound ...)")
    .option("-f, --file <file>", "Target file path")
    .option("-l, --line <line>", "Target line number", parseInt)
    .action(async (opts) => {
      const config = getConfig();
      const octokit = getOctokit();
      const ctx = await extractReviewContext(
        octokit,
        config.owner,
        config.repo,
        opts.pr,
        opts.comment,
        opts.file,
        opts.line
      );
      await handlePrRevision({
        ctx,
        octokit,
        config,
      });
    });

  return program;
}

// Auto-run if executed directly
if (
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js") ||
  process.argv[1]?.endsWith("githound")
) {
  if (process.env.GITHUB_EVENT_PATH && process.argv.length <= 2) {
    runGitHubAction().catch((err) => {
      console.error("GitHound Action failed:", err);
      process.exit(1);
    });
  } else {
    createCli().parse(process.argv);
  }
}
