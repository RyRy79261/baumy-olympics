import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createHttpDb, type Queryable } from "@baumy/db";
import {
  describeFields,
  type Proposal,
  type ProposalChoices,
} from "@/lib/ai/proposal";
import { runGate } from "@/lib/auth/gates";
import type { PinVerifier } from "@/lib/auth/pin";
import type { AnyActionDef, Gate, RequestCtx } from "./define";

// Turn a write Claude asked for into a proposal (SPEC §3.6, §6.3): the same
// surface check and Zod parse `runAction` does, the gate it would pick (so
// the kiosk knows to ask for a PIN), and the action's own preview line. It
// never executes anything: approving goes through POST /api/actions/run,
// with the proposal id as the idempotency key.
//
// A proposal that fails the checks is still returned, marked invalid, so the
// sheet can show what Claude wanted and why it cannot be approved as it is.

export interface ProposerDeps {
  readDb: () => Queryable;
  newId: () => string;
  logError: (message: string, err: unknown) => void;
}

const defaultDeps: ProposerDeps = {
  readDb: () => createHttpDb() as unknown as Queryable,
  newId: randomUUID,
  logError: (message, err) => console.error(message, err),
};

export type Proposer = (
  name: string,
  rawInput: unknown,
  ctx: RequestCtx,
  choices: ProposalChoices,
) => Promise<Proposal>;

/** Never called: the attested gate, the only one that checks a PIN, is skipped. */
const noPinHere: PinVerifier = async () => ({ ok: false, reason: "no_pin" });

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function createProposer(
  registry: Readonly<Record<string, AnyActionDef>>,
  deps: ProposerDeps = defaultDeps,
): Proposer {
  return async (name, rawInput, ctx, choices) => {
    const input = asRecord(rawInput);
    const def = Object.hasOwn(registry, name) ? registry[name] : undefined;
    const base = {
      proposalId: deps.newId(),
      name,
      input,
      needsPin: false,
    };
    if (!def || def.kind !== "write" || !def.surfaces.includes(ctx.source)) {
      return {
        ...base,
        title: def?.title ?? name,
        preview: `Baumy asked for "${name}", which it cannot do.`,
        risk: def?.risk ?? "confirm",
        valid: false,
        error: "Baumy can't do this. Do it in the app instead.",
        fields: [],
      };
    }

    const fields = describeFields(
      z.toJSONSchema(def.input, { io: "input" }) as Record<string, unknown>,
      choices,
    );
    const common = { ...base, title: def.title, risk: def.risk, fields };
    const parsed = (def.input as z.ZodType).safeParse(input);
    if (!parsed.success) {
      return {
        ...common,
        preview: def.title,
        valid: false,
        error: "Some of this is not valid. Edit it, or reject it.",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
          message: i.message,
        })),
      };
    }

    const gate: Gate =
      typeof def.requires === "function"
        ? def.requires(ctx, parsed.data)
        : def.requires;
    let preview = def.title;
    if (def.preview) {
      try {
        preview = await def.preview({ ...ctx, db: deps.readDb() }, parsed.data);
      } catch (err) {
        deps.logError(`[propose:${name}] preview failed`, err);
      }
    }
    // Who may approve it: the gate runAction will run, now, so a proposal
    // nobody here can approve (an admin action asked for by a member, or at
    // the kiosk) says so instead of failing on approval. The attested gate
    // is left for approval, where the kiosk sends the PIN.
    if (gate !== "attested") {
      const allowed = await runGate(gate, ctx, def, noPinHere);
      if (!allowed.ok) {
        return { ...common, preview, valid: false, error: allowed.message };
      }
    }
    return {
      ...common,
      preview,
      valid: true,
      needsPin: ctx.actor.kind === "kiosk" && gate === "attested",
    };
  };
}
