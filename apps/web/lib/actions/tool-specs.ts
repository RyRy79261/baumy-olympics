import { z } from "zod";
import type { Surface } from "@baumy/types";
import type { ActionRisk, AnyActionDef } from "./define";
import { REGISTRY } from "./registry";

// Tool definitions generated from the registry (ADR 0002): the Claude `tools`
// for the AI command, the MCP tool list and brain's schema list.

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the input the caller sends (Zod's input side). */
  input_schema: Record<string, unknown>;
  risk: ActionRisk;
}

/** Destructive actions are never exposed over MCP or to brain (SPEC §9). */
const NO_DESTRUCTIVE: ReadonlySet<Surface> = new Set(["mcp", "brain"]);

export function toolSpecs(
  surface: Surface,
  registry: Readonly<Record<string, AnyActionDef>> = REGISTRY,
): ToolSpec[] {
  return Object.values(registry)
    .filter((def) => def.surfaces.includes(surface))
    .filter(
      (def) => !(def.risk === "destructive" && NO_DESTRUCTIVE.has(surface)),
    )
    .map((def) => ({
      name: def.name,
      description: def.description,
      input_schema: z.toJSONSchema(def.input, { io: "input" }) as Record<
        string,
        unknown
      >,
      risk: def.risk,
    }));
}
