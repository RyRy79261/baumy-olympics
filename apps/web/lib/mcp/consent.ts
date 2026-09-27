import "server-only";

import type { AnyActionDef } from "@/lib/actions/define";
import { REGISTRY } from "@/lib/actions/registry";

// What the consent screen says each scope allows (SPEC §6.3): the consent
// line of every tool a connection would get, from the registry, so a new
// MCP action shows up here without anyone editing the page. Destructive
// actions are never offered over MCP (tool-specs.ts), so they are not listed.

export interface ConsentLines {
  read: string[];
  write: string[];
}

export function consentLines(
  registry: Readonly<Record<string, AnyActionDef>> = REGISTRY,
): ConsentLines {
  const out: ConsentLines = { read: [], write: [] };
  for (const def of Object.values(registry)) {
    if (!def.surfaces.includes("mcp") || def.risk === "destructive") continue;
    const list = out[def.kind as "read" | "write"];
    if (!list.includes(def.consent)) list.push(def.consent);
  }
  return out;
}
