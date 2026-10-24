import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { VerificationResult } from "./types.js";

const execAsync = promisify(exec);

export class VerificationRunner {
  constructor(private cwd: string = process.cwd()) {}

  async runCommand(command: string): Promise<VerificationResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        success: true,
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } catch (err: any) {
      return {
        success: false,
        command,
        stdout: (err.stdout || "").trim(),
        stderr: (err.stderr || err.message || "").trim(),
        error: err.message,
      };
    }
  }

  async runVerificationGate(commands: string[]): Promise<{
    passed: boolean;
    results: VerificationResult[];
    failureSummary?: string;
  }> {
    const results: VerificationResult[] = [];
    for (const cmd of commands) {
      if (!cmd || cmd.trim() === "") continue;
      const res = await this.runCommand(cmd);
      results.push(res);
      if (!res.success) {
        const failureDetails = [
          `Command failed: \`${cmd}\``,
          res.stderr ? `Error output:\n${res.stderr}` : "",
          res.stdout ? `Standard output:\n${res.stdout}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        return {
          passed: false,
          results,
          failureSummary: failureDetails,
        };
      }
    }

    return {
      passed: true,
      results,
    };
  }
}
