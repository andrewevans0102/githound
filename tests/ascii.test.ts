import { describe, expect, it } from "vitest";
import { formatPrDescription, formatRevisionComment, HARVEY_ASCII } from "../src/ascii.js";

describe("ASCII & formatting utilities", () => {
  it("contains the Harvey mascot in ASCII art", () => {
    expect(HARVEY_ASCII).toContain("GitHound");
    expect(HARVEY_ASCII).toContain("(\\");
  });

  it("formats PR description with issue details and verification log", () => {
    const description = formatPrDescription({
      issueNumber: 42,
      issueTitle: "Add slugify utility",
      summary: "Created slugify helper and tests",
      filesChanged: ["src/slugify.ts", "tests/slugify.test.ts"],
      testOutputSummary: "12 tests passed",
    });

    expect(description).toContain("Resolves #42: **Add slugify utility**");
    expect(description).toContain("GitHound");
    expect(description).toContain("`src/slugify.ts`");
    expect(description).toContain("`tests/slugify.test.ts`");
    expect(description).toContain("12 tests passed");
    expect(description).toContain("/hound <instructions>");
  });

  it("formats revision comments cleanly", () => {
    const comment = formatRevisionComment({
      prNumber: 43,
      commitHash: "b4c102a99999",
      summary: "Fixed trailing dash handling",
      testsPassed: true,
    });

    expect(comment).toContain("Fixed trailing dash handling");
    expect(comment).toContain("b4c102a");
    expect(comment).toContain("Passed ✅");
  });
});
