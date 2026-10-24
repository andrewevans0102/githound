import { describe, expect, it } from "vitest";
import { createCli, getConfig } from "../src/index.js";

describe("CLI & Config", () => {
  it("creates CLI with commands", () => {
    const cli = createCli();
    const commandNames = cli.commands.map((c) => c.name());
    expect(commandNames).toContain("action");
    expect(commandNames).toContain("verify");
    expect(commandNames).toContain("handle-issue");
    expect(commandNames).toContain("handle-review");
  });

  it("reads default config values", () => {
    const config = getConfig();
    expect(config.maxRetries).toBeGreaterThan(0);
    expect(config.model).toContain("gemini");
    expect(config.botName).toBe("githound[bot]");
  });
});
