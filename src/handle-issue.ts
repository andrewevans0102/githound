import { Octokit } from "@octokit/rest";
import { formatPrDescription } from "./ascii.js";
import { GitManager } from "./git.js";
import { ModelClient } from "./llm.js";
import { VerificationRunner } from "./runner.js";
import type { FileEdit, GitHoundConfig, IssueContext } from "./types.js";

export async function handleIssueIntake(params: {
  octokit: Octokit;
  config: GitHoundConfig;
  issue: IssueContext;
  repoContext?: string;
  gitManager?: GitManager;
  modelClient?: ModelClient;
  verificationRunner?: VerificationRunner;
}): Promise<{
  prNumber: number;
  prUrl: string;
  branchName: string;
  filesChanged: string[];
}> {
  const {
    octokit,
    config,
    issue,
    repoContext,
    gitManager = new GitManager(),
    modelClient = new ModelClient(undefined, config.model),
    verificationRunner = new VerificationRunner(),
  } = params;

  console.log(`🐾 GitHound: Intake triggered for Issue #${issue.issueNumber} ("${issue.title}")`);

  // 1. Create and checkout isolated branch
  const branchName = `githound/issue-${issue.issueNumber}`;
  console.log(`Creating isolated branch: ${branchName}`);
  gitManager.checkoutBranch(branchName, true);

  // 2. Initial LLM code generation
  console.log("Generating solution with Gemini...");
  let solution = await modelClient.generateIssueSolution({
    issueNumber: issue.issueNumber,
    title: issue.title,
    body: issue.body,
    repoContext,
  });

  if (solution.edits.length === 0) {
    throw new Error("GitHound model did not propose any file edits.");
  }

  // 3. Apply edits
  let appliedFiles = gitManager.applyFileEdits(solution.edits);
  console.log(`Applied edits to ${appliedFiles.length} files.`);

  // 4. Deterministic Verification Gate Loop with Self-Correction
  const commandsToRun = [config.typecheckCommand, config.testCommand].filter(Boolean) as string[];

  let passed = false;
  let attempts = 0;
  let lastFailure = "";
  let accumulatedEdits: FileEdit[] = [...solution.edits];
  let testLog = "";

  while (!passed && attempts < config.maxRetries) {
    attempts++;
    console.log(`Running verification gate (attempt ${attempts}/${config.maxRetries})...`);

    const result = await verificationRunner.runVerificationGate(commandsToRun);
    if (result.passed) {
      passed = true;
      testLog = result.results.map((r) => `$ ${r.command}\n${r.stdout}`).join("\n\n");
      console.log("✅ Verification gate passed!");
      break;
    }

    lastFailure = result.failureSummary || "Unknown test/typecheck failure";
    console.warn(`⚠️ Gate failed on attempt ${attempts}:\n${lastFailure}`);

    if (attempts < config.maxRetries) {
      console.log("Feeding failure output back to Gemini for self-correction...");
      const correction = await modelClient.generateCorrection({
        originalGoal: `Issue #${issue.issueNumber}: ${issue.title}\n${issue.body}`,
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
    const errorMsg = `GitHound self-correction exhausted (${config.maxRetries} attempts). Tests failed:\n${lastFailure}`;
    await octokit.issues.createComment({
      owner: config.owner,
      repo: config.repo,
      issue_number: issue.issueNumber,
      body: `🐾 **GitHound was unable to pass verification gates.**\n\n${errorMsg}`,
    });
    throw new Error(errorMsg);
  }

  // 5. Commit and push
  const commitMsg = `feat: resolve #${issue.issueNumber} - ${issue.title}`;
  gitManager.commitAll(commitMsg, config.botName, config.botEmail);
  gitManager.pushBranch(branchName, "origin", true);

  // 6. Open Pull Request
  const prBody = formatPrDescription({
    issueNumber: issue.issueNumber,
    issueTitle: issue.title,
    summary: solution.summary,
    filesChanged: appliedFiles,
    testOutputSummary: testLog,
  });

  const { data: pr } = await octokit.pulls.create({
    owner: config.owner,
    repo: config.repo,
    title: `feat: ${issue.title}`,
    head: branchName,
    base: config.baseBranch,
    body: prBody,
  });

  console.log(`🐾 PR opened: #${pr.number} - ${pr.html_url}`);

  // Link PR in issue comment
  await octokit.issues.createComment({
    owner: config.owner,
    repo: config.repo,
    issue_number: issue.issueNumber,
    body: `🐾 GitHound has created pull request #${pr.number} to address this issue: ${pr.html_url}`,
  });

  return {
    prNumber: pr.number,
    prUrl: pr.html_url,
    branchName,
    filesChanged: appliedFiles,
  };
}
