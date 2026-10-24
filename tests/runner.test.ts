import { describe, expect, it } from "vitest";
import { VerificationRunner } from "../src/runner.js";

describe("VerificationRunner", () => {
  const runner = new VerificationRunner();

  it("passes for successful shell command", async () => {
    const res = await runner.runCommand('node -e "process.exit(0)"');
    expect(res.success).toBe(true);
  });

  it("fails and captures error for unsuccessful command", async () => {
    const res = await runner.runCommand('node -e "console.error(\'Boom\'); process.exit(1)"');
    expect(res.success).toBe(false);
    expect(res.stderr).toContain("Boom");
  });

  it("runs verification gate across multiple commands", async () => {
    const gate = await runner.runVerificationGate([
      'node -e "console.log(\'Gate 1 Passed\')"',
      'node -e "console.log(\'Gate 2 Passed\')"',
    ]);

    expect(gate.passed).toBe(true);
    expect(gate.results.length).toBe(2);
  });

  it("halts verification gate immediately upon first failure", async () => {
    const gate = await runner.runVerificationGate([
      'node -e "console.error(\'Typecheck error\'); process.exit(1)"',
      'node -e "console.log(\'Should not run\')"',
    ]);

    expect(gate.passed).toBe(false);
    expect(gate.results.length).toBe(1);
    expect(gate.failureSummary).toContain("Typecheck error");
  });
});
