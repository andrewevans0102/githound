import { describe, expect, it, vi } from "vitest";
import { extractReviewContext } from "../src/extract-context.js";

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
