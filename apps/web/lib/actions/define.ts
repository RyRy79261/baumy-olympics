import type { z } from "zod";
import type { Queryable } from "@baumy/db";
import type { Surface } from "@baumy/types";
import type { Actor } from "@/lib/auth";
import type { ActionFailure } from "./result";

// ADR 0002, SPEC §6.3: every capability is one `ActionDef`. The UI, the AI
// command, MCP and baumy-brain are adapters that call `runAction` (run.ts).

/**
 * Every registered action. registry.ts is typed against this list, so an
 * entry cannot be missing from either side.
 */
export const ACTION_NAMES = ["whoami", "update_my_profile"] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

/** A valid Claude and MCP tool name. */
export const ACTION_NAME_PATTERN = /^[a-z0-9_]{1,64}$/;

/**
 * Who may run an action, one gate function per concern (lib/auth/gates.ts):
 * - `member`: any household member; kiosk actors only where
 *   `surfaces` includes "kiosk";
 * - `admin`: an admin with a real session;
 * - `attested`: the member themself (a session, MCP or brain is its own
 *   member; the kiosk must send that member's PIN with the request);
 * - `session`: a real cookie or bearer session, never the kiosk, MCP or brain;
 * - `account`: a real session whether or not it has a member row yet. Only
 *   for joining the household (`redeem_invite`, `join_as_founder`);
 * - `service`: a service token (baumy-brain).
 */
export type Gate =
  "member" | "admin" | "attested" | "session" | "account" | "service";

export type ActionKind = "read" | "write";
export type ActionRisk = "safe" | "confirm" | "destructive";

/** What an adapter knows about a request before the action runs. */
export interface RequestCtx {
  actor: Actor;
  source: Surface;
  householdId: string;
  /** The idempotency key. Every write needs one. */
  requestId?: string;
  /** Kiosk only: the acting member's PIN, verified in this request. */
  pin?: string;
  /** The client address, for the per-IP rate limit. */
  ip?: string;
  /** From lib/clock.ts, never `new Date()`. */
  now: Date;
}

/**
 * What `execute` receives: the request plus the database handle `runAction`
 * chose. For a transactional write that is the transaction holding the
 * idempotency claim; otherwise the stateless driver.
 */
export interface ActionCtx extends RequestCtx {
  db: Queryable;
}

/** What `runAction` writes to `audit_events` for a successful write. */
export interface AuditInfo {
  entity: string;
  entityId?: string | null;
  /** Defaults to the parsed input. */
  payload?: unknown;
}

export type ExecuteResult<O> =
  | {
      ok: true;
      data: O;
      /** Defaults to `{ entity: <action name> }`. */
      audit?: AuditInfo;
      /**
       * `transactional: false` only: reverses the external effect if the audit
       * row cannot be written afterwards (SPEC §6.4).
       */
      undo?: () => Promise<void>;
      /**
       * `account` actions only: the member this request just created. An
       * account has no member to key the ledger and the audit row on until
       * the action makes one, so `runAction` keys both on this.
       */
      joinedAs?: string;
      /**
       * What the idempotency ledger keeps for a replay, when `data` holds a
       * secret that must not be stored (a one-time code). Defaults to `data`.
       */
      storedData?: O;
    }
  | ActionFailure;

export interface RateLimitSpec {
  /** Calls per window for one actor. */
  perMember: number;
  /** Calls per window from one IP address. */
  perIp: number;
  windowMs: number;
}

export interface ActionDef<I extends z.ZodType, O, N extends string = string> {
  /** snake_case, `^[a-z0-9_]{1,64}$`. */
  name: N;
  title: string;
  /** The LLM tool description, so it is part of the product. */
  description: string;
  /** The line the MCP consent screen shows. Never empty. */
  consent: string;
  kind: ActionKind;
  risk: ActionRisk;
  /** Admin-only actions are `["ui"]`. */
  surfaces: readonly Surface[];
  /** A gate, or a function of the parsed input that picks one. */
  requires: Gate | ((ctx: RequestCtx, input: z.output<I>) => Gate);
  /**
   * Default true: `execute` runs in the transaction holding the claim. False
   * for external calls (Google, brain): no transaction is open while it runs.
   */
  transactional?: boolean;
  /** Overrides the defaults in run.ts. */
  rateLimit?: RateLimitSpec;
  /** Zod v4; `z.toJSONSchema` of it is the Claude and MCP tool schema. */
  input: I;
  /**
   * The part of the parsed input that the ledger's `input_hash` and the
   * default audit payload see. Set it when the input holds a secret (a PIN, a
   * password): an unsalted sha256 of a 4-digit PIN is no secret at all.
   */
  fingerprint?: (input: z.output<I>) => unknown;
  /** One line a human approves, e.g. "Log Trash for Ryan: +25 (streak 2)". */
  preview?(ctx: ActionCtx, input: z.output<I>): Promise<string>;
  execute(ctx: ActionCtx, input: z.output<I>): Promise<ExecuteResult<O>>;
}

/** Any action, for the registry and adapters that do not care which. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyActionDef = ActionDef<any, any, string>;

type NameChar =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z"
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "_";

type AllNameChars<S extends string> = S extends ""
  ? true
  : S extends `${infer C}${infer Rest}`
    ? C extends NameChar
      ? AllNameChars<Rest>
      : false
    : false;

/**
 * `N` when it is a snake_case literal, else `never`, so `defineAction` refuses
 * `"Log-Chore"` at compile time. The 64-character cap is checked at runtime.
 */
export type ValidActionName<N extends string> = N extends ""
  ? never
  : AllNameChars<N> extends true
    ? N
    : never;

/** `never` for the empty string, so a blank consent line does not compile. */
export type NonEmptyString<S extends string> = S extends "" ? never : S;

/**
 * Declare an action. The name and consent line are checked by the types (see
 * above) and again here at runtime, so a computed string cannot slip past.
 */
export function defineAction<
  N extends string,
  C extends string,
  I extends z.ZodType,
  O,
>(
  def: Omit<ActionDef<I, O, N>, "name" | "consent"> & {
    name: N & ValidActionName<N>;
    consent: C & NonEmptyString<C>;
  },
): ActionDef<I, O, N> {
  if (!ACTION_NAME_PATTERN.test(def.name)) {
    throw new Error(
      `Action name "${def.name}" must match ${ACTION_NAME_PATTERN}.`,
    );
  }
  if (def.consent.trim() === "") {
    throw new Error(`Action "${def.name}" needs a consent line.`);
  }
  if (def.description.trim() === "") {
    throw new Error(`Action "${def.name}" needs a description.`);
  }
  if (def.surfaces.length === 0) {
    throw new Error(`Action "${def.name}" is offered on no surface.`);
  }
  return def;
}
