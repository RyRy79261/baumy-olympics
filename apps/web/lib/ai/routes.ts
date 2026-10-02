import "server-only";

import { z } from "zod";
import {
  commandSystemPrompt,
  type CommandChore,
  type CommandMember,
} from "@baumy/ai-prompts";
import type { ClaimAiCommand } from "@baumy/db/ai-usage";
import type { RequestCtx } from "@/lib/actions/define";
import { fail, type ActionResult } from "@/lib/actions/result";
import { rejectCrossSite } from "@/lib/http/origin";
import type { ClaudeClient } from "@/lib/integrations/claude";
import { redactSecrets } from "@/lib/redact";
import { runCommand, type CommandDeps } from "./command";
import { aiFailure } from "./errors";
import type { Proposal, ProposalChoices } from "./proposal";

// The three cookie-authenticated routes of the Baumy command (SPEC §6.3,
// §9). Each checks Origin/Sec-Fetch-Site first, then who is asking, from the
// phone (a person's session) or the kiosk (the paired device and the member
// whose avatar was tapped). Every one runs as the `ai` surface.
//
//   POST /api/ai/command    {text, history?, surface?}
//        → {ok: true, data: {reply, proposals, choices}}
//   POST /api/ai/proposal   {name, input, surface?}: re-check and preview an
//        edited proposal → {ok: true, data: proposal}
//   POST /api/actions/run   {name, input, requestId, surface?, pin?}: run an
//        approved proposal through runAction, `requestId` = its proposal id
//        → the action's result
//
// Failures are `{ok: false, code, message}` like an action's.

export type Surface = "ui" | "kiosk";

export interface AiRouteDeps {
  /** The request context for the device, or null when not signed in. */
  requestCtx: (
    surface: Surface,
    requestId: string | undefined,
    pin: string | undefined,
  ) => Promise<RequestCtx | null>;
  /** The household's active members and chores, for prompts and pickers. */
  loadHousehold: (
    ctx: RequestCtx,
  ) => Promise<{ members: CommandMember[]; chores: CommandChore[] }>;
  logError: (message: string, err: unknown) => void;
}

export interface CommandRouteDeps extends AiRouteDeps {
  claude: () => ClaudeClient;
  model: string;
  /** The member's daily limit, and one claim against it. */
  dailyLimit: () => number;
  claim: (
    ctx: RequestCtx,
    model: string,
    limit: number,
  ) => Promise<ClaimAiCommand>;
  recordTokens: (
    usageId: string,
    tokens: { inputTokens: number; outputTokens: number },
  ) => Promise<void>;
  loop: Omit<CommandDeps, "create" | "model" | "onUsage">;
}

export interface ProposalRouteDeps extends AiRouteDeps {
  propose: CommandDeps["propose"];
}

export interface RunRouteDeps {
  requestCtx: AiRouteDeps["requestCtx"];
  runAction: CommandDeps["runAction"];
}

export function respond(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function invalid(error: z.ZodError): Response {
  return respond(
    400,
    fail("INVALID_INPUT", "That request was not valid.", {
      issues: error.issues.map((i) => ({
        path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: i.message,
      })),
    }),
  );
}

const SurfaceField = z.enum(["ui", "kiosk"]).optional();

/**
 * The asker as the `ai` surface, or the response refusing them: 401 with
 * nobody signed in, 403 without a member (a kiosk where nobody has tapped
 * their avatar).
 */
export async function aiCtx(
  deps: Pick<AiRouteDeps, "requestCtx">,
  surface: Surface,
  requestId?: string,
  pin?: string,
): Promise<RequestCtx | Response> {
  const ctx = await deps.requestCtx(surface, requestId, pin);
  if (!ctx) {
    return respond(
      401,
      fail(
        "UNAUTHENTICATED",
        surface === "kiosk"
          ? "This kiosk is not paired any more."
          : "Sign in to talk to Baumy.",
      ),
    );
  }
  if (!ctx.actor.memberId) {
    return respond(
      403,
      fail(
        "FORBIDDEN",
        ctx.actor.kind === "kiosk"
          ? "Tap your avatar first, then ask Baumy."
          : "Only household members can talk to Baumy.",
      ),
    );
  }
  return { ...ctx, source: "ai" };
}

function choicesOf(h: {
  members: CommandMember[];
  chores: CommandChore[];
}): ProposalChoices {
  return {
    members: h.members.map((m) => ({ value: m.id, label: m.displayName })),
    chores: h.chores.map((c) => ({ value: c.id, label: c.name })),
  };
}

const CommandBody = z.strictObject({
  text: z.string().trim().min(1, "Say something to Baumy.").max(1000),
  history: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(4000),
      }),
    )
    .max(24)
    .optional(),
  surface: SurfaceField,
});

export interface CommandData {
  reply: string;
  proposals: Proposal[];
  choices: ProposalChoices;
}

export async function handleCommand(
  req: Request,
  deps: CommandRouteDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const body = CommandBody.safeParse(await readJson(req));
  if (!body.success) return invalid(body.error);
  const ctx = await aiCtx(deps, body.data.surface ?? "ui");
  if (ctx instanceof Response) return ctx;

  const claude = deps.claude();
  if (!claude.ok) {
    return respond(
      501,
      fail(
        "NOT_CONFIGURED",
        "Baumy isn't connected to Claude on this deployment yet.",
      ),
    );
  }

  const limit = deps.dailyLimit();
  const claim = await deps.claim(ctx, deps.model, limit);
  if (!claim.ok) {
    return respond(
      429,
      fail(
        "RATE_LIMITED",
        limit === 0
          ? "Baumy is switched off on this deployment."
          : `You've asked Baumy ${limit} times today, which is the daily limit. Try again tomorrow.`,
      ),
    );
  }

  const tokens = { inputTokens: 0, outputTokens: 0 };
  try {
    const household = await deps.loadHousehold(ctx);
    const me = household.members.find((m) => m.id === ctx.actor.memberId);
    const system = commandSystemPrompt({
      now: ctx.now,
      actor: {
        id: ctx.actor.memberId!,
        displayName: me?.displayName ?? "the acting member",
        // A kiosk admin may add and edit bounties with their PIN (#147).
        admin:
          (ctx.actor.kind === "member" || ctx.actor.kind === "kiosk") &&
          ctx.actor.role === "admin",
      },
      device: ctx.actor.kind === "kiosk" ? "kiosk" : "phone",
      members: household.members,
      chores: household.chores,
    });
    const choices = choicesOf(household);
    const outcome = await runCommand(
      {
        text: body.data.text,
        history: body.data.history ?? [],
        system,
        choices,
      },
      ctx,
      {
        ...deps.loop,
        create: claude.create,
        model: deps.model,
        onUsage: (u) => {
          tokens.inputTokens += u.inputTokens;
          tokens.outputTokens += u.outputTokens;
        },
      },
    );
    const data: CommandData = { ...outcome, choices };
    return respond(200, { ok: true, data });
  } catch (err) {
    const mapped = aiFailure(err);
    deps.logError(
      "[ai:command] failed",
      redactSecrets(
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      ),
    );
    if (mapped) return respond(mapped.status, mapped.body);
    return respond(
      502,
      fail("INTERNAL", "Baumy got muddled. Please try again."),
    );
  } finally {
    try {
      await deps.recordTokens(claim.usageId, tokens);
    } catch (err) {
      deps.logError("[ai:command] could not record usage", err);
    }
  }
}

const ProposalBody = z.strictObject({
  name: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()),
  surface: SurfaceField,
});

export async function handleProposal(
  req: Request,
  deps: ProposalRouteDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const body = ProposalBody.safeParse(await readJson(req));
  if (!body.success) return invalid(body.error);
  const ctx = await aiCtx(deps, body.data.surface ?? "ui");
  if (ctx instanceof Response) return ctx;
  try {
    const household = await deps.loadHousehold(ctx);
    const proposal = await deps.propose(
      body.data.name,
      body.data.input,
      ctx,
      choicesOf(household),
    );
    return respond(200, { ok: true, data: proposal });
  } catch (err) {
    deps.logError("[ai:proposal] failed", err);
    return respond(
      500,
      fail("INTERNAL", "Something went wrong. Please try again."),
    );
  }
}

const RunBody = z.strictObject({
  name: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().min(1).max(128),
  surface: SurfaceField,
  pin: z.string().max(12).optional(),
});

export async function handleRunAction(
  req: Request,
  deps: RunRouteDeps,
): Promise<Response> {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const body = RunBody.safeParse(await readJson(req));
  if (!body.success) return invalid(body.error);
  const surface = body.data.surface ?? "ui";
  const ctx = await aiCtx(
    deps,
    surface,
    body.data.requestId,
    // Only the kiosk attests with a PIN; a session is its own member.
    surface === "kiosk" && body.data.pin ? body.data.pin : undefined,
  );
  if (ctx instanceof Response) return ctx;
  const result: ActionResult<unknown> = await deps.runAction(
    body.data.name,
    body.data.input ?? {},
    ctx,
  );
  return respond(200, result);
}
