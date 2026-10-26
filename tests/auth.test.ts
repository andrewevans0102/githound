import { describe, expect, it, vi } from "vitest";
import { isOwner, runGitHubAction } from "../src/index.js";
import * as handleIssueModule from "../src/handle-issue.js";
import * as handleRevisionModule from "../src/handle-revision.js";
import * as extractContextModule from "../src/extract-context.js";

describe("Owner Authorization & Dispatcher Security", () => {
  describe("isOwner", () => {
    it("returns true when authorAssociation is OWNER", () => {
      expect(isOwner("random-user", "OWNER", "real-owner")).toBe(true);
    });

    it("returns true when login matches expected owner case-insensitively", () => {
      expect(isOwner("AndrewEvans", "CONTRIBUTOR", "andrewevans")).toBe(true);
      expect(isOwner("andrewevans", undefined, "AndrewEvans")).toBe(true);
    });

    it("returns false when user is not owner and association is not OWNER", () => {
      expect(isOwner("unauthorized-user", "CONTRIBUTOR", "real-owner")).toBe(false);
      expect(isOwner("unauthorized-user", undefined, "real-owner")).toBe(false);
      expect(isOwner(undefined, undefined, "real-owner")).toBe(false);
    });
  });

  describe("runGitHubAction Authorization Gates", () => {
    const config = {
      owner: "real-owner",
      repo: "githound",
      maxRetries: 1,
      testCommand: "npm test",
      typecheckCommand: "npm run typecheck",
      model: "gemini-2.5-flash",
      botName: "githound[bot]",
      botEmail: "githound[bot]@users.noreply.github.com",
      baseBranch: "main",
    };

    it("rejects issue intake if issue author is not the owner", async () => {
      const handleIssueSpy = vi.spyOn(handleIssueModule, "handleIssueIntake").mockResolvedValue({
        prNumber: 1,
        prUrl: "https://github.com/real-owner/githound/pull/1",
        branchName: "githound/issue-1",
        filesChanged: [],
      });

      const event = {
        action: "labeled",
        label: { name: "githound" },
        issue: {
          number: 1,
          title: "Malicious Request",
          body: "Fix something",
          user: { login: "attacker" },
          author_association: "NONE",
        },
        sender: {
          login: "real-owner",
          author_association: "OWNER",
        },
      };

      await runGitHubAction({
        event,
        eventName: "issues",
        config,
        octokit: {} as any,
      });

      expect(handleIssueSpy).not.toHaveBeenCalled();
      handleIssueSpy.mockRestore();
    });

    it("rejects issue intake if labeler is not the owner", async () => {
      const handleIssueSpy = vi.spyOn(handleIssueModule, "handleIssueIntake").mockResolvedValue({
        prNumber: 1,
        prUrl: "https://github.com/real-owner/githound/pull/1",
        branchName: "githound/issue-1",
        filesChanged: [],
      });

      const event = {
        action: "labeled",
        label: { name: "githound" },
        issue: {
          number: 1,
          title: "Owner Request",
          body: "Fix something",
          user: { login: "real-owner" },
          author_association: "OWNER",
        },
        sender: {
          login: "unauthorized-collaborator",
          author_association: "CONTRIBUTOR",
        },
      };

      await runGitHubAction({
        event,
        eventName: "issues",
        config,
        octokit: {} as any,
      });

      expect(handleIssueSpy).not.toHaveBeenCalled();
      handleIssueSpy.mockRestore();
    });

    it("allows issue intake when both issue author and labeler are the owner", async () => {
      const handleIssueSpy = vi.spyOn(handleIssueModule, "handleIssueIntake").mockResolvedValue({
        prNumber: 1,
        prUrl: "https://github.com/real-owner/githound/pull/1",
        branchName: "githound/issue-1",
        filesChanged: ["file.ts"],
      });

      const event = {
        action: "labeled",
        label: { name: "githound" },
        issue: {
          number: 1,
          title: "Legitimate Owner Issue",
          body: "Please implement feature",
          labels: [{ name: "githound" }],
          user: { login: "real-owner" },
          author_association: "OWNER",
        },
        sender: {
          login: "real-owner",
          author_association: "OWNER",
        },
      };

      await runGitHubAction({
        event,
        eventName: "issues",
        config,
        octokit: {} as any,
      });

      expect(handleIssueSpy).toHaveBeenCalledTimes(1);
      handleIssueSpy.mockRestore();
    });

    it("rejects PR comment trigger (/hound) if commenter is not the owner", async () => {
      const handleRevisionSpy = vi.spyOn(handleRevisionModule, "handlePrRevision").mockResolvedValue({
        commitHash: "hash123",
        modifiedFiles: [],
      });
      const extractContextSpy = vi.spyOn(extractContextModule, "extractReviewContext").mockResolvedValue({
        prNumber: 5,
        branchName: "githound/issue-5",
        diff: "",
        commentBody: "/hound please change this",
      });

      const event = {
        action: "created",
        comment: {
          id: 10,
          body: "/hound modify security settings",
          user: { login: "unauthorized-commenter" },
          author_association: "NONE",
        },
        pull_request: {
          number: 5,
        },
        sender: {
          login: "unauthorized-commenter",
        },
      };

      await runGitHubAction({
        event,
        eventName: "pull_request_review_comment",
        config,
        octokit: {} as any,
      });

      expect(extractContextSpy).not.toHaveBeenCalled();
      expect(handleRevisionSpy).not.toHaveBeenCalled();

      extractContextSpy.mockRestore();
      handleRevisionSpy.mockRestore();
    });

    it("allows PR comment trigger (/hound) when commenter is the owner", async () => {
      const handleRevisionSpy = vi.spyOn(handleRevisionModule, "handlePrRevision").mockResolvedValue({
        commitHash: "hash123",
        modifiedFiles: ["file.ts"],
      });
      const extractContextSpy = vi.spyOn(extractContextModule, "extractReviewContext").mockResolvedValue({
        prNumber: 5,
        branchName: "githound/issue-5",
        diff: "",
        commentBody: "/hound refine edge cases",
      });

      const event = {
        action: "created",
        comment: {
          id: 10,
          body: "/hound refine edge cases",
          user: { login: "real-owner" },
          author_association: "OWNER",
        },
        pull_request: {
          number: 5,
        },
        sender: {
          login: "real-owner",
        },
      };

      await runGitHubAction({
        event,
        eventName: "pull_request_review_comment",
        config,
        octokit: {} as any,
      });

      expect(extractContextSpy).toHaveBeenCalledTimes(1);
      expect(handleRevisionSpy).toHaveBeenCalledTimes(1);

      extractContextSpy.mockRestore();
      handleRevisionSpy.mockRestore();
    });
  });
});
