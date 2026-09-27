import { describe, expect, it } from "vitest";
import { z } from "zod";
import { surface } from "@baumy/db/schema";
import { SURFACES } from "@baumy/types";
import {
  ACTION_NAMES,
  ACTION_NAME_PATTERN,
  defineAction,
  type AnyActionDef,
} from "./define";
import { REGISTRY } from "./registry";

// The registry's invariants (ADR 0002): every name is a valid Claude and MCP
// tool name, every action has a consent line, and the list in define.ts and
// the map in registry.ts agree.

const entries = Object.entries(REGISTRY) as [string, AnyActionDef][];

describe("the registry", () => {
  it("has an entry, keyed by its own name, for every ActionName", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(Object.keys(REGISTRY).sort()).toEqual([...ACTION_NAMES].sort());
    for (const [key, def] of entries) expect(def.name).toBe(key);
  });

  it("every registered name matches ^[a-z0-9_]{1,64}$", () => {
    for (const [, def] of entries) {
      expect(def.name).toMatch(/^[a-z0-9_]{1,64}$/);
    }
    // The pattern itself refuses what it should.
    for (const bad of ["", "Log", "log-chore", "a b", "x".repeat(65), "é"]) {
      expect(ACTION_NAME_PATTERN.test(bad)).toBe(false);
    }
    expect(ACTION_NAME_PATTERN.test("x".repeat(64))).toBe(true);
  });

  it("every action has a non-empty consent line, title and description", () => {
    for (const [, def] of entries) {
      expect(def.consent.trim()).not.toBe("");
      expect(def.title.trim()).not.toBe("");
      expect(def.description.trim()).not.toBe("");
      expect(def.surfaces.length).toBeGreaterThan(0);
    }
  });

  it("offers destructive actions only on ui, kiosk and ai", () => {
    for (const [, def] of entries) {
      if (def.risk !== "destructive") continue;
      expect(def.surfaces).not.toContain("mcp");
      expect(def.surfaces).not.toContain("brain");
    }
  });

  it("guards writes that need a real session to the ui", () => {
    for (const [, def] of entries) {
      if (def.requires === "session" || def.requires === "admin") {
        expect(def.surfaces).toEqual(["ui"]);
      }
    }
  });
});

describe("Surface", () => {
  it("the Zod enum and the pg enum list the same values in the same order", () => {
    expect(surface.enumValues).toEqual([...SURFACES]);
  });
});

describe("defineAction", () => {
  const base = {
    title: "T",
    description: "D",
    kind: "read" as const,
    risk: "safe" as const,
    surfaces: ["ui"] as const,
    requires: "member" as const,
    input: z.strictObject({}),
    execute: async () => ({ ok: true as const, data: null }),
  };

  it("returns the definition it is given", () => {
    const def = defineAction({ ...base, name: "fine_name_2", consent: "C" });
    expect(def.name).toBe("fine_name_2");
  });

  it("refuses a bad name or a blank consent line at compile time and at runtime", () => {
    expect(() =>
      // @ts-expect-error -- not snake_case
      defineAction({ ...base, name: "Bad-Name", consent: "C" }),
    ).toThrow(/must match/);
    expect(() =>
      // @ts-expect-error -- the empty consent line
      defineAction({ ...base, name: "ok_name", consent: "" }),
    ).toThrow(/consent/);
    // Too long for the pattern: the types do not count characters (and a
    // computed name is not a literal at all).
    expect(() =>
      // @ts-expect-error -- not a literal name
      defineAction({ ...base, name: "x".repeat(65), consent: "C" }),
    ).toThrow(/must match/);
    // Computed strings get past the types, not past the runtime check.
    const blank = " ".repeat(2) as string;
    expect(() =>
      defineAction({ ...base, name: "ok_name", consent: blank }),
    ).toThrow(/consent/);
    expect(() =>
      defineAction({
        ...base,
        description: " ",
        name: "ok_name",
        consent: "C",
      }),
    ).toThrow(/description/);
    expect(() =>
      defineAction({ ...base, surfaces: [], name: "ok_name", consent: "C" }),
    ).toThrow(/no surface/);
  });
});
