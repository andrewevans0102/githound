export const HARVEY_ASCII = `
                  __
     (\\,--------'()'--o
      (_    ___    /~"
       (_)_)  (_)_)
       [ GitHound ]
`;

export function formatPrDescription(params: {
  issueNumber: number;
  issueTitle: string;
  summary: string;
  filesChanged: string[];
  testOutputSummary?: string;
}): string {
  return `### 🐾 GitHound (Harvey) Report

Resolves #${params.issueNumber}: **${params.issueTitle}**

\`\`\`
${HARVEY_ASCII.trim()}
\`\`\`

#### 📋 Summary of Changes
${params.summary}

#### 📁 Files Touched
${params.filesChanged.map((f) => `- \`${f}\``).join("\n") || "- None"}

#### 🛡️ Verification Gate
- Local tests and type checks executed and passed before opening this PR.
${params.testOutputSummary ? `\n<details><summary>Verification Log</summary>\n\n\`\`\`text\n${params.testOutputSummary}\n\`\`\`\n</details>` : ""}

---
*Need adjustments? Highlight any lines in this PR diff and comment with \`/hound <instructions>\`!*`;
}

export function formatRevisionComment(params: {
  prNumber: number;
  commitHash?: string;
  summary: string;
  testsPassed: boolean;
}): string {
  return `🐾 **GitHound Update**

${params.summary}

${params.commitHash ? `- Commit: \`${params.commitHash.slice(0, 7)}\`` : ""}
- Verification Gate: ${params.testsPassed ? "Passed ✅" : "Failed ❌"}

*Harvey is keeping a sharp eye on this branch.*`;
}
