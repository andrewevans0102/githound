import { describe, expect, it, vi } from "vitest";
import {
  extractFailureRelatedFiles,
  extractRepoContext,
  extractReviewContext,
} from "../src/extract-context.js";

describe("extractReviewContext", () => {
  it("extracts PR branch and diff", async () => {
    const mockOctokit: any = {
      pulls: {
        get: vi.fn().mockImplementation((args: any) => {
          if (args.mediaType?.format === "diff") {
            return Promise.resolve({ data: "diff --git a/test.ts b/test.ts\n+const a = 1;" });
          }
          return Promise.resolve({
            data: {
              head: { ref: "githound/issue-10" },
              base: { ref: "main" },
            },
          });
        }),
      },
    };

    const ctx = await extractReviewContext(
      mockOctokit,
      "andrewevans0102",
      "githound",
      10,
      "/hound please optimize"
    );

    expect(ctx.prNumber).toBe(10);
    expect(ctx.branchName).toBe("githound/issue-10");
    expect(ctx.diff).toContain("+const a = 1;");
    expect(ctx.commentBody).toBe("/hound please optimize");
  });
});

describe("extractRepoContext", () => {
  it("extracts repository file tree and file contents", () => {
    const context = extractRepoContext();
    expect(context).toContain("### Tracked Repository Files:");
    expect(context).toContain("package.json");
    expect(context).toContain("### Existing File Contents:");
    expect(context).toContain("--- File: package.json ---");
  });
});

describe("extractFailureRelatedFiles", () => {
  it("detects files mentioned in failure logs", () => {
    const fakeFailureLog = "AssertionError: failed at src/index.ts:15:10";
    const files = extractFailureRelatedFiles(fakeFailureLog);
    expect(files.some((f) => f.path === "src/index.ts")).toBe(true);
    const indexFile = files.find((f) => f.path === "src/index.ts");
    expect(indexFile?.content).toContain("export function");
  });

  it("returns empty array when no files are mentioned", () => {
    const fakeFailureLog = "General error without any file references";
    const files = extractFailureRelatedFiles(fakeFailureLog);
    expect(files).toEqual([]);
  });
});
