import { FunctionDeclaration, GoogleGenAI, Tool, Type } from "@google/genai";
import type { FileEdit, ReviewContext } from "./types.js";

const writeFileDeclaration: FunctionDeclaration = {
  name: "write_file",
  description: "Write or update a file on disk with the given content.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: "Relative path to the file to create or update.",
      },
      content: {
        type: Type.STRING,
        description: "Complete text content of the file.",
      },
    },
    required: ["path", "content"],
  },
};

const deleteFileDeclaration: FunctionDeclaration = {
  name: "delete_file",
  description: "Delete an unwanted or deprecated file from disk.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: "Relative path of the file to remove.",
      },
    },
    required: ["path"],
  },
};

const TOOLS: Tool[] = [
  {
    functionDeclarations: [writeFileDeclaration, deleteFileDeclaration],
  },
];

export interface ModelEditResult {
  summary: string;
  edits: FileEdit[];
}

export class ModelClient {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey?: string, model = "gemini-2.5-flash") {
    this.ai = new GoogleGenAI({
      apiKey: apiKey || process.env.GEMINI_API_KEY,
    });
    this.model = model;
  }

  async generateIssueSolution(params: {
    issueNumber: number;
    title: string;
    body: string;
    repoContext?: string;
  }): Promise<ModelEditResult> {
    const prompt = `
You are GitHound, a diligent and precise coding watchdog powered by Google Gemini.
Your job is to implement the requested feature or fix for GitHub Issue #${params.issueNumber}:
Title: "${params.title}"

Description:
${params.body}

${params.repoContext ? `Repository Context:\n${params.repoContext}` : ""}

Instructions:
1. Provide the complete code edits needed to solve this issue.
2. Use the \`write_file\` tool to create or update files.
3. Keep changes clean, minimal, robust, and well-tested.
4. Include unit tests for any new logic where applicable.
`;

    return this.runModelLoop(prompt);
  }

  async generateRevision(ctx: ReviewContext): Promise<ModelEditResult> {
    const prompt = `
You are GitHound, a code-review revision assistant powered by Google Gemini.
The reviewer left the following feedback on pull request #${ctx.prNumber}:
"${ctx.commentBody}"

${ctx.commentPath ? `Target File: ${ctx.commentPath}` : ""}
${ctx.lineSnippet ? `Code context near comment:\n\`\`\`\n${ctx.lineSnippet}\n\`\`\`` : ""}

Current PR Diff:
\`\`\`diff
${ctx.diff}
\`\`\`

Instructions:
1. Address the review comment precisely.
2. Ensure changes are minimal and adhere strictly to project conventions.
3. Use the \`write_file\` tool to update files.
4. Update or add unit tests if the reviewer requested test coverage.
`;

    return this.runModelLoop(prompt);
  }

  async generateCorrection(params: {
    originalGoal: string;
    failureSummary: string;
    previousEdits: FileEdit[];
  }): Promise<ModelEditResult> {
    const prompt = `
You are GitHound powered by Google Gemini. The previous code modifications triggered a failure in the deterministic verification gate.

Goal:
${params.originalGoal}

Verification Gate Failure Output:
\`\`\`text
${params.failureSummary}
\`\`\`

Previously modified files:
${params.previousEdits.map((e) => `- ${e.path} (${e.action})`).join("\n")}

Instructions:
1. Analyze the exact compiler, typechecker, or test failure above.
2. Provide corrective file updates using the \`write_file\` tool to fix the errors.
3. Do not introduce extraneous changes.
`;

    return this.runModelLoop(prompt);
  }

  private async runModelLoop(prompt: string): Promise<ModelEditResult> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        tools: TOOLS,
      },
    });

    const edits: FileEdit[] = [];
    let summaryText = response.text || "";

    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        if (call.name === "write_file") {
          const args = call.args as { path: string; content: string };
          edits.push({
            path: args.path,
            content: args.content,
            action: "update",
          });
        } else if (call.name === "delete_file") {
          const args = call.args as { path: string };
          edits.push({
            path: args.path,
            content: "",
            action: "delete",
          });
        }
      }
    }

    if (edits.length === 0) {
      // Fallback: look for markdown code blocks with file path hints
      const fallbackEdits = this.parseFallbackCodeBlocks(summaryText);
      edits.push(...fallbackEdits);
    }

    return {
      summary: summaryText.trim() || "Applied code modifications to address the request.",
      edits,
    };
  }

  private parseFallbackCodeBlocks(text: string): FileEdit[] {
    const edits: FileEdit[] = [];
    const blockRegex = /(?:###?\s*(?:File:\s*)?([^\n`]+)\n)?```(?:\w+)?\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(text)) !== null) {
      const headerPath = match[1]?.trim();
      const content = match[2];
      if (headerPath && (headerPath.includes("/") || headerPath.includes("."))) {
        edits.push({
          path: headerPath,
          content,
          action: "update",
        });
      }
    }

    return edits;
  }
}
