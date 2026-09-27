import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAction, type AnyActionDef } from "./define";
import { toolSpecs } from "./tool-specs";

// The generated tool JSON is part of the product (ADR 0002): the Claude tool
// list for the AI command and the MCP tool list. A snapshot makes every change
// to a name, description or schema show up in review.

describe("toolSpecs", () => {
  it("builds the ai tools", async () => {
    const specs = toolSpecs("ai");
    expect(specs.map((s) => s.name)).toContain("whoami");
    await expect(`${JSON.stringify(specs, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/tool-specs.ai.json",
    );
  });

  it("builds the mcp tools", async () => {
    const specs = toolSpecs("mcp");
    expect(specs.map((s) => s.name)).toContain("whoami");
    await expect(`${JSON.stringify(specs, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/tool-specs.mcp.json",
    );
  });

  it("includes only actions offered on the surface", () => {
    // update_my_profile is ui only.
    expect(toolSpecs("ui").map((s) => s.name)).toContain("update_my_profile");
    expect(toolSpecs("ai").map((s) => s.name)).not.toContain(
      "update_my_profile",
    );
    expect(toolSpecs("mcp").map((s) => s.name)).not.toContain(
      "update_my_profile",
    );
  });

  it("never exposes a destructive action over mcp or to brain", () => {
    const drop = defineAction({
      name: "test_delete",
      title: "Delete",
      description: "Deletes a thing.",
      consent: "Delete things",
      kind: "write",
      risk: "destructive",
      surfaces: ["ui", "ai", "mcp", "brain"],
      requires: "member",
      input: z.strictObject({ id: z.string() }),
      execute: async () => ({ ok: true as const, data: null }),
    });
    const registry: Record<string, AnyActionDef> = { test_delete: drop };
    expect(toolSpecs("ai", registry).map((s) => s.name)).toEqual([
      "test_delete",
    ]);
    expect(toolSpecs("mcp", registry)).toEqual([]);
    expect(toolSpecs("brain", registry)).toEqual([]);
    expect(toolSpecs("ai", registry)[0]).toMatchObject({
      risk: "destructive",
      input_schema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    });
  });
});
