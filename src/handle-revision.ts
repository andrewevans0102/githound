import { Octokit } from "@octokit/rest";
import { formatRevisionComment } from "./ascii.js";
import { GitManager } from "./git.js";
import { ModelClient } from "./llm.js";
import { VerificationRunner } from "./runner.js";
import type { FileEdit, GitHoundConfig, ReviewContext } from "./types.js";

export async function handlePrRevision(params: {
  ctx: ReviewContext;
  octokit: Octokit;
  config: GitHoundConfig;
  commentId?: number;
  gitManager?: GitManager;
  modelClient?: ModelClient;
  verificationRunner?: VerificationRunner;
}): Promise<{
  commitHash: string;
  modifiedFiles: string[];
}> {
  const {
    ctx,
    octokit,
    config,
    commentId,
    gitManager = new GitManager(),
    modelClient = new ModelClient(undefined, config.model),
    verificationRunner = new VerificationRunner(),
  } = params;

  console.log(`🐾 GitHound: Revision triggered on PR #${ctx.prNumber}`);

  // Acknowledge review comment with an eyes reaction if commentId provided
  if (commentId) {
    try {
      if (ctx.commentPath) {
        await octokit.pulls.createReplyForReviewComment({
          owner: config.owner,
          repo: config.repo,
          pull_number: ctx.prNumber,
          comment_id: commentId,
          body: "👀 GitHound (Harvey) is analyzing your review and preparing a patch...",
        });
      } else {
        await octokit.issues.createComment({
          owner: config.owner,
          repo: config.repo,
          issue_number: ctx.prNumber,
          body: "👀 GitHound (Harvey) is analyzing your review and preparing a patch...",
        });
      }
    } catch (err) {
      console.warn("Could not post reaction comment:", err);
    }
  }

  // 1. Switch to PR branch
  console.log(`Checking out PR branch: ${ctx.branchName}`);
  gitManager.checkoutBranch(ctx.branchName, false);

  // 2. Call LLM with compacted review context
  console.log("Generating targeted patch from review feedback...");
  const revision = await modelClient.generateRevision(ctx);

  if (revision.edits.length === 0) {
    throw new Error("GitHound model did not propose any file edits for this review comment.");
  }

  // 3. Apply edits
  let appliedFiles = gitManager.applyFileEdits(revision.edits);
  console.log(`Applied revision edits to ${appliedFiles.length} files.`);

  // 4. Deterministic Quality Gate with Self-Correction
  const commandsToRun = [config.typecheckCommand, config.testCommand].filter(Boolean) as string[];

  let passed = false;
  let attempts = 0;
  let lastFailure = "";
  let accumulatedEdits: FileEdit[] = [...revision.edits];

  while (!passed && attempts < config.maxRetries) {
    attempts++;
    console.log(`Running verification gate (attempt ${attempts}/${config.maxRetries})...`);

    const result = await verificationRunner.runVerificationGate(commandsToRun);
    if (result.passed) {
      passed = true;
      console.log("✅ Verification gate passed!");
      break;
    }

    lastFailure = result.failureSummary || "Unknown test/typecheck failure";
    console.warn(`⚠️ Gate failed on attempt ${attempts}:\n${lastFailure}`);

    if (attempts < config.maxRetries) {
      console.log("Re-prompting model with compiler/test failure output...");
      const correction = await modelClient.generateCorrection({
        originalGoal: `Address PR #${ctx.prNumber} review comment: "${ctx.commentBody}"`,
        failureSummary: lastFailure,
        previousEdits: accumulatedEdits,
      });

      if (correction.edits.length > 0) {
        const newlyApplied = gitManager.applyFileEdits(correction.edits);
        accumulatedEdits.push(...correction.edits);
        appliedFiles = Array.from(new Set([...appliedFiles, ...newlyApplied]));
      }
    }
  }

  if (!passed) {
    const failureMsg = `GitHound generated code that failed test suite after ${config.maxRetries} attempts. Aborting commit.\n\n${lastFailure}`;
    await octokit.issues.createComment({
      owner: config.owner,
      repo: config.repo,
      issue_number: ctx.prNumber,
      body: `🐾 **GitHound was unable to satisfy review feedback:**\n\n\`\`\`text\n${failureMsg}\n\`\`\``,
    });
    throw new Error(failureMsg);
  }

  // 5. Commit and push back to branch
  const commitMsg = `chore(githound): address review feedback on #${ctx.prNumber}`;
  const commitHash = gitManager.commitAll(commitMsg, config.botName, config.botEmail);
  gitManager.pushBranch(ctx.branchName, "origin", false);

  // 6. Post confirmation reply on PR
  const replyComment = formatRevisionComment({
    prNumber: ctx.prNumber,
    commitHash,
    summary: revision.summary,
    testsPassed: true,
  });

  await octokit.issues.createComment({
    owner: config.owner,
    repo: config.repo,
    issue_number: ctx.prNumber,
    body: replyComment,
  });

  console.log(`🐾 Successfully pushed commit ${commitHash.slice(0, 7)} to ${ctx.branchName}`);

  return {
    commitHash,
    modifiedFiles: appliedFiles,
  };
}
