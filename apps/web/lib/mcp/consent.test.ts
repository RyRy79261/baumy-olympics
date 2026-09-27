import { z } from "zod";
import { describe, expect, it } from "vitest";
import { defineAction, type AnyActionDef } from "@/lib/actions/define";
import { REGISTRY } from "@/lib/actions/registry";
import { consentLines } from "./consent";

// The consent screen lists every MCP tool's consent line under its scope.

describe("consentLines", () => {
  it("lists the registry's MCP reads and writes under their scopes", () => {
    const lines = consentLines();
    expect(lines.read).toContain(REGISTRY.whoami.consent);
    expect(lines.read).toContain(REGISTRY.get_standings.consent);
    expect(lines.write).toContain(REGISTRY.log_completion.consent);
    // Not offered over MCP, or destructive: never listed.
    expect([...lines.read, ...lines.write]).not.toContain(
      REGISTRY.authorize_mcp_client.consent,
    );
    expect(lines.write).not.toContain(REGISTRY.delete_note.consent);
  });

  it("skips destructive and non-MCP actions and lists a line once", () => {
    const base = {
      title: "T",
      description: "D",
      risk: "safe" as const,
      requires: "member" as const,
      input: z.strictObject({}),
      execute: async () => ({ ok: true as const, data: null }),
    };
    const registry: Record<string, AnyActionDef> = {
      a: defineAction({
        ...base,
        name: "a",
        consent: "Same",
        kind: "read",
        surfaces: ["mcp"],
      }),
      b: defineAction({
        ...base,
        name: "b",
        consent: "Same",
        kind: "read",
        surfaces: ["mcp"],
      }),
      c: defineAction({
        ...base,
        name: "c",
        consent: "Gone",
        kind: "write",
        surfaces: ["mcp"],
        risk: "destructive",
      }),
      d: defineAction({
        ...base,
        name: "d",
        consent: "UI",
        kind: "write",
        surfaces: ["ui"],
      }),
      e: defineAction({
        ...base,
        name: "e",
        consent: "Do",
        kind: "write",
        surfaces: ["mcp"],
      }),
    };
    expect(consentLines(registry)).toEqual({ read: ["Same"], write: ["Do"] });
  });
});
