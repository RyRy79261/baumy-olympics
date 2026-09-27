import { z } from "zod";
import type { Surface } from "@baumy/types";
import type { ActionKind, ActionRisk, AnyActionDef } from "./define";
import { REGISTRY } from "./registry";

// Tool definitions generated from the registry (ADR 0002): the Claude `tools`
// for the AI command, the MCP tool list and brain's schema list.

export interface ToolSpec {
  name: string;
  /** The human title (MCP clients show it in their tool approval prompt). */
  title: string;
  description: string;
  /** JSON Schema of the input the caller sends (Zod's input side). */
  input_schema: Record<string, unknown>;
  /** Which MCP scope the tool needs (baumy:read or baumy:write). */
  kind: ActionKind;
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
      title: def.title,
      description: def.description,
      input_schema: z.toJSONSchema(def.input, { io: "input" }) as Record<
        string,
        unknown
      >,
      kind: def.kind,
      risk: def.risk,
    }));
}
