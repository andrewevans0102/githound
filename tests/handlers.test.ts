import { describe, expect, it, vi } from "vitest";
import { handleIssueIntake } from "../src/handle-issue.js";
import { handlePrRevision } from "../src/handle-revision.js";
import type { GitHoundConfig } from "../src/types.js";

describe("Handlers: Issue Intake & PR Revision", () => {
  const config: GitHoundConfig = {
    owner: "owner",
    repo: "githound",
    maxRetries: 3,
    testCommand: "npm test",
    typecheckCommand: "npm run typecheck",
    model: "gemini-2.5-flash",
    botName: "githound[bot]",
    botEmail: "githound[bot]@users.noreply.github.com",
    baseBranch: "main",
  };

  it("handles issue intake with successful verification gate", async () => {
    const mockOctokit: any = {
      pulls: {
        create: vi.fn().mockResolvedValue({
          data: {
            number: 101,
            html_url: "https://github.com/owner/githound/pull/101",
          },
        }),
      },
      issues: {
        createComment: vi.fn().mockResolvedValue({}),
      },
    };

    const mockGit: any = {
      checkoutBranch: vi.fn(),
      applyFileEdits: vi.fn().mockReturnValue(["src/feature.ts"]),
      commitAll: vi.fn().mockReturnValue("abcdef1234567890"),
      pushBranch: vi.fn(),
    };

    const mockModel: any = {
      generateIssueSolution: vi.fn().mockResolvedValue({
        summary: "Implemented requested feature",
        edits: [{ path: "src/feature.ts", content: "code", action: "create" }],
      }),
    };

    const mockRunner: any = {
      runVerificationGate: vi.fn().mockResolvedValue({
        passed: true,
        results: [{ success: true, command: "npm test", stdout: "all passed", stderr: "" }],
      }),
    };

    const result = await handleIssueIntake({
      octokit: mockOctokit,
      config,
      issue: {
        issueNumber: 42,
        title: "Add Slugify",
        body: "Please add slugify utility",
        branchName: "githound/issue-42",
        labels: ["githound"],
      },
      gitManager: mockGit,
      modelClient: mockModel,
      verificationRunner: mockRunner,
    });

    expect(result.prNumber).toBe(101);
    expect(mockGit.checkoutBranch).toHaveBeenCalledWith("githound/issue-42", true);
    expect(mockGit.commitAll).toHaveBeenCalled();
    expect(mockOctokit.pulls.create).toHaveBeenCalled();
  });

  it("handles PR revision with self-correction when test fails initially", async () => {
    const mockOctokit: any = {
      issues: {
        createComment: vi.fn().mockResolvedValue({}),
      },
      pulls: {
        createReplyForReviewComment: vi.fn().mockResolvedValue({}),
      },
    };

    const mockGit: any = {
      checkoutBranch: vi.fn(),
      applyFileEdits: vi.fn().mockReturnValue(["src/slugify.ts"]),
      commitAll: vi.fn().mockReturnValue("fedcba0987654321"),
      pushBranch: vi.fn(),
    };

    const mockModel: any = {
      generateRevision: vi.fn().mockResolvedValue({
        summary: "Added edge case handler",
        edits: [{ path: "src/slugify.ts", content: "fixed code", action: "update" }],
      }),
      generateCorrection: vi.fn().mockResolvedValue({
        summary: "Fixed compiler error",
        edits: [{ path: "src/slugify.ts", content: "corrected code", action: "update" }],
      }),
    };

    // First attempt fails, second attempt succeeds
    let attempts = 0;
    const mockRunner: any = {
      runVerificationGate: vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve({
            passed: false,
            results: [{ success: false, command: "npm test", stdout: "", stderr: "SyntaxError" }],
            failureSummary: "SyntaxError on line 12",
          });
        }
        return Promise.resolve({
          passed: true,
          results: [{ success: true, command: "npm test", stdout: "passed", stderr: "" }],
        });
      }),
    };

    const result = await handlePrRevision({
      ctx: {
        prNumber: 101,
        branchName: "githound/issue-42",
        diff: "+function test() {}",
        commentBody: "/hound please fix edge case",
      },
      octokit: mockOctokit,
      config,
      commentId: 888,
      gitManager: mockGit,
      modelClient: mockModel,
      verificationRunner: mockRunner,
    });

    expect(result.commitHash).toBe("fedcba0987654321");
    expect(mockModel.generateCorrection).toHaveBeenCalledTimes(1);
    expect(mockGit.pushBranch).toHaveBeenCalledWith("githound/issue-42", "origin", false);
    expect(mockOctokit.issues.createComment).toHaveBeenCalled();
  });
});
