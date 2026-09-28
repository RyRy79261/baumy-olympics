// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { RequestCtx } from "@/lib/actions/define";
import type { ActionResult } from "@/lib/actions/result";
import { toolSpecs } from "@/lib/actions/tool-specs";
import { actionKind } from "@/lib/actions/registry";
import type { RateLimiter } from "@/lib/rate-limit";
import {
  GENERIC_ERROR,
  LINK_RATE_LIMIT,
  TOKEN_RATE_LIMIT,
  bearerToken,
  handleBrainAction,
  handleListActions,
  needsConfirmation,
  parseActor,
  statusFor,
  type BrainEndpointDeps,
} from "./endpoint";

// The brain endpoint's adapter logic with fakes for the token check, the
// Telegram mapping and runAction (issue #27): auth, actor mapping, the link
// exception, the confirm header, the surface filter and the idempotency key.
// lib/brain/flow.test.ts runs the same routes against the real registry.

const MEMBER = "22222222-2222-4222-8222-222222222222";
const HOUSEMATE = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const LINKED_TG = 1001;
const UNLINKED_TG = 2002;
const NOW = new Date("2026-09-27T10:00:00.000Z");

const TOKENS: Record<string, { name: string; scopes: string[] }> = {
  good: { name: "baumy-brain", scopes: ["brain"] },
  other: { name: "robot", scopes: ["something-else"] },
};

function setup(
  opts: {
    result?: ActionResult<unknown>;
    limiter?: RateLimiter;
    runThrows?: boolean;
  } = {},
) {
  const runAction = vi.fn(
    async (
      _name: string,
      _input: unknown,
      _ctx: RequestCtx,
    ): Promise<ActionResult<unknown>> => {
      if (opts.runThrows) throw new Error("boom");
      return opts.result ?? { ok: true, data: { ran: true } };
    },
  );
  const limit = vi.fn(
    opts.limiter?.limit ?? (async () => ({ ok: true, retryAfterSeconds: 0 })),
  );
  const logError = vi.fn();
  const deps: BrainEndpointDeps = {
    verifyToken: vi.fn(async (t: string) => TOKENS[t] ?? null),
    findMember: vi.fn(async (tg: number) =>
      tg === LINKED_TG ? { id: MEMBER } : null,
    ),
    // Postgres matches a uuid in any case; the row's id is lower-case.
    findHousemate: vi.fn(async (id: string) =>
      id.toLowerCase() === HOUSEMATE || id.toLowerCase() === MEMBER
        ? { id: id.toLowerCase() }
        : null,
    ),
    specs: () => toolSpecs("brain"),
    isAction: (name) => actionKind(name) !== undefined,
    runAction,
    rateLimiter: { limit },
    householdId: "house-1",
    now: () => NOW,
    logError,
  };
  return { deps, runAction, limit, logError };
}

function post(
  name: string,
  opts: {
    token?: string | null;
    actor?: string | null;
    confirmed?: string;
    key?: string | null;
    body?: string;
    onBehalfOf?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "198.51.100.7",
  };
  const token = opts.token === undefined ? "good" : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  const actor = opts.actor === undefined ? `tg:${LINKED_TG}` : opts.actor;
  if (actor) headers["x-baumy-actor"] = actor;
  if (opts.confirmed !== undefined) {
    headers["x-baumy-confirmed"] = opts.confirmed;
  }
  if (opts.onBehalfOf !== undefined) {
    headers["x-baumy-on-behalf-of"] = opts.onBehalfOf;
  }
  const key = opts.key === undefined ? "brain-key-0001" : opts.key;
  if (key) headers["idempotency-key"] = key;
  return new Request(`http://localhost:3000/api/v1/actions/${name}`, {
    method: "POST",
    headers,
    body: opts.body ?? "{}",
  });
}

const get = (token: string | null = "good") =>
  new Request("http://localhost:3000/api/v1/actions", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

async function body(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/v1/actions", () => {
  it("lists the brain tools with their risk, destructive ones included, never admin ones", async () => {
    const { deps } = setup();
    const res = await handleListActions(get(), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { actions } = (await res.json()) as {
      actions: { name: string; risk: string; input_schema: unknown }[];
    };
    const names = actions.map((a) => a.name);
    expect(names).toContain("create_event");
    expect(names).toContain("link_telegram");
    expect(actions.find((a) => a.name === "create_event")?.risk).toBe(
      "confirm",
    );
    expect(names).toContain("delete_event");
    expect(actions.find((a) => a.name === "delete_event")?.risk).toBe(
      "destructive",
    );
    expect(names).not.toContain("manage_members");
  });

  it("needs a live token with the brain scope", async () => {
    const { deps } = setup();
    for (const token of [null, "nope"]) {
      const res = await handleListActions(get(token), deps);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
      expect(await body(res)).toMatchObject({ code: "UNAUTHENTICATED" });
    }
    const wrongScope = await handleListActions(get("other"), deps);
    expect(wrongScope.status).toBe(403);
  });

  it("rate-limits per token", async () => {
    const { deps, limit } = setup({
      limiter: { limit: async () => ({ ok: false, retryAfterSeconds: 9 }) },
    });
    const res = await handleListActions(get(), deps);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(limit).toHaveBeenCalledWith(
      "brain:token:baumy-brain",
      TOKEN_RATE_LIMIT,
    );
  });

  it("answers a generic 500 when something throws", async () => {
    const { deps, logError } = setup();
    deps.verifyToken = async () => {
      throw new Error("db down: postgres://secret");
    };
    const res = await handleListActions(get(), deps);
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({
      ok: false,
      code: "INTERNAL",
      message: GENERIC_ERROR,
    });
    expect(logError).toHaveBeenCalled();
  });
});

describe("POST /api/v1/actions/{name}", () => {
  it("runs a linked member's confirmed write as brain, keyed on the Idempotency-Key", async () => {
    const { deps, runAction } = setup();
    const res = await handleBrainAction(
      post("create_event", {
        confirmed: "1",
        body: JSON.stringify({ title: "Dinner" }),
      }),
      "create_event",
      deps,
    );
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: true, data: { ran: true } });
    expect(runAction).toHaveBeenCalledWith(
      "create_event",
      { title: "Dinner" },
      {
        actor: {
          kind: "service",
          tokenName: "baumy-brain",
          telegramUserId: LINKED_TG,
          memberId: MEMBER,
        },
        source: "brain",
        householdId: "house-1",
        requestId: "brain-key-0001",
        ip: "198.51.100.7",
        now: NOW,
      },
    );
  });

  it("refuses a missing, unknown or out-of-scope token before anything else", async () => {
    const { deps, runAction } = setup();
    for (const token of [null, "nope"]) {
      const res = await handleBrainAction(
        post("whoami", { token }),
        "whoami",
        deps,
      );
      expect(res.status).toBe(401);
    }
    const res = await handleBrainAction(
      post("whoami", { token: "other" }),
      "whoami",
      deps,
    );
    expect(res.status).toBe(403);
    expect(runAction).not.toHaveBeenCalled();
  });

  it("says SURFACE_FORBIDDEN for admin and UI-only actions, 404 for unknown ones", async () => {
    const { deps, runAction } = setup();
    for (const name of ["manage_members", "update_my_profile", "mint_invite"]) {
      const res = await handleBrainAction(
        post(name, { confirmed: "1" }),
        name,
        deps,
      );
      expect(res.status).toBe(403);
      expect(await body(res)).toMatchObject({ code: "SURFACE_FORBIDDEN" });
    }
    const unknown = await handleBrainAction(post("nope"), "nope", deps);
    expect(unknown.status).toBe(404);
    expect(await body(unknown)).toMatchObject({ code: "UNKNOWN_ACTION" });
    expect(runAction).not.toHaveBeenCalled();
  });

  it("needs X-Baumy-Actor: tg:<id>", async () => {
    const { deps, runAction } = setup();
    for (const actor of [null, "1001", "tg:", "tg:abc", "tg:-5", "user:1001"]) {
      const res = await handleBrainAction(
        post("whoami", { actor }),
        "whoami",
        deps,
      );
      expect(res.status).toBe(400);
      expect(await body(res)).toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(runAction).not.toHaveBeenCalled();
  });

  it("gives an unlinked Telegram user a 403 for anything but link_telegram", async () => {
    const { deps, runAction } = setup();
    const res = await handleBrainAction(
      post("whoami", { actor: `tg:${UNLINKED_TG}` }),
      "whoami",
      deps,
    );
    expect(res.status).toBe(403);
    expect(await body(res)).toMatchObject({ code: "TELEGRAM_NOT_LINKED" });
    expect(runAction).not.toHaveBeenCalled();

    const link = await handleBrainAction(
      post("link_telegram", {
        actor: `tg:${UNLINKED_TG}`,
        body: JSON.stringify({ code: "ABCDEFGH23" }),
      }),
      "link_telegram",
      deps,
    );
    expect(link.status).toBe(200);
    const [, input, ctx] = runAction.mock.calls[0]!;
    expect(input).toEqual({ code: "ABCDEFGH23" });
    // No member: link_telegram takes it from the code.
    expect(ctx.actor).toEqual({
      kind: "service",
      tokenName: "baumy-brain",
      telegramUserId: UNLINKED_TG,
    });
  });

  it("limits link_telegram per token too", async () => {
    const { deps, limit, runAction } = setup({
      limiter: {
        limit: async (key) =>
          key.startsWith("brain:link:")
            ? { ok: false, retryAfterSeconds: 60 }
            : { ok: true, retryAfterSeconds: 0 },
      },
    });
    const res = await handleBrainAction(
      post("link_telegram", { body: JSON.stringify({ code: "ABCDEFGH23" }) }),
      "link_telegram",
      deps,
    );
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith(
      "brain:link:baumy-brain",
      LINK_RATE_LIMIT,
    );
    expect(runAction).not.toHaveBeenCalled();
    // Other actions do not use that bucket.
    const other = await handleBrainAction(post("whoami"), "whoami", deps);
    expect(other.status).toBe(200);
  });

  it("needs X-Baumy-Confirmed: 1 for confirm-risk actions only", async () => {
    const { deps, runAction } = setup();
    for (const confirmed of [undefined, "0", "true", "yes"]) {
      const res = await handleBrainAction(
        post("log_completion", { confirmed }),
        "log_completion",
        deps,
      );
      expect(res.status).toBe(428);
      expect(await body(res)).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    }
    expect(runAction).not.toHaveBeenCalled();
    // A safe write needs no confirmation.
    const safe = await handleBrainAction(
      post("create_note", { body: JSON.stringify({ title: "Wifi" }) }),
      "create_note",
      deps,
    );
    expect(safe.status).toBe(200);
  });

  it("needs X-Baumy-Confirmed: 1 for destructive actions too", async () => {
    const { deps, runAction } = setup();
    for (const name of ["delete_event", "delete_note"]) {
      const res = await handleBrainAction(post(name), name, deps);
      expect(res.status).toBe(428);
      expect(await body(res)).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    }
    expect(runAction).not.toHaveBeenCalled();
    const res = await handleBrainAction(
      post("delete_event", {
        confirmed: "1",
        body: JSON.stringify({ eventId: "abcde12345" }),
      }),
      "delete_event",
      deps,
    );
    expect(res.status).toBe(200);
    expect(runAction).toHaveBeenCalledWith(
      "delete_event",
      { eventId: "abcde12345" },
      expect.objectContaining({ source: "brain" }),
    );
  });

  it("needs a valid Idempotency-Key on writes, but not on reads", async () => {
    const { deps, runAction } = setup();
    for (const key of [null, "short", "has space in it", "x".repeat(129)]) {
      const res = await handleBrainAction(
        post("create_note", { key }),
        "create_note",
        deps,
      );
      expect(res.status).toBe(400);
      expect(await body(res)).toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(runAction).not.toHaveBeenCalled();

    const read = await handleBrainAction(
      post("whoami", { key: null }),
      "whoami",
      deps,
    );
    expect(read.status).toBe(200);
    expect(runAction.mock.calls[0]![2]).not.toHaveProperty("requestId");
  });

  it("takes an empty body as {}, and refuses anything but a JSON object", async () => {
    const { deps, runAction } = setup();
    const empty = await handleBrainAction(
      post("whoami", { body: "" }),
      "whoami",
      deps,
    );
    expect(empty.status).toBe(200);
    expect(runAction.mock.calls[0]![1]).toEqual({});
    for (const raw of ["{", "[]", "null", '"x"', "7", "x".repeat(70_000)]) {
      const res = await handleBrainAction(
        post("whoami", { body: raw }),
        "whoami",
        deps,
      );
      expect(res.status).toBe(400);
    }
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it("maps an action's refusal to its status, keeping only what people read", async () => {
    const { deps } = setup({
      result: {
        ok: false,
        code: "COOLDOWN",
        message: "Trash was done recently.",
        retryAt: "2026-09-28T10:00:00.000Z",
      },
    });
    const res = await handleBrainAction(
      post("log_completion", { confirmed: "1" }),
      "log_completion",
      deps,
    );
    expect(res.status).toBe(422);
    expect(await body(res)).toEqual({
      ok: false,
      code: "COOLDOWN",
      message: "Trash was done recently.",
      retryAt: "2026-09-28T10:00:00.000Z",
    });
  });

  it("passes issues and rate limits through, and hides INTERNAL detail", async () => {
    const invalid = setup({
      result: {
        ok: false,
        code: "INVALID_INPUT",
        message: "Some of that is not valid.",
        issues: [{ path: ["title"], message: "Required" }],
      },
    });
    const bad = await handleBrainAction(
      post("create_note"),
      "create_note",
      invalid.deps,
    );
    expect(bad.status).toBe(400);
    expect(await body(bad)).toMatchObject({
      issues: [{ path: ["title"], message: "Required" }],
    });

    const limited = setup({
      result: {
        ok: false,
        code: "RATE_LIMITED",
        message: "Too many.",
        retryAfterSeconds: 30,
      },
    });
    const slow = await handleBrainAction(
      post("create_note"),
      "create_note",
      limited.deps,
    );
    expect(slow.status).toBe(429);
    expect(slow.headers.get("retry-after")).toBe("30");

    const internal = setup({
      result: { ok: false, code: "INTERNAL", message: "select * from x" },
    });
    const res = await handleBrainAction(
      post("create_note"),
      "create_note",
      internal.deps,
    );
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({
      ok: false,
      code: "INTERNAL",
      message: GENERIC_ERROR,
    });
  });

  it("answers a generic 500 when runAction throws", async () => {
    const { deps, logError } = setup({ runThrows: true });
    const res = await handleBrainAction(post("whoami"), "whoami", deps);
    expect(res.status).toBe(500);
    expect(await body(res)).toMatchObject({ message: GENERIC_ERROR });
    expect(logError).toHaveBeenCalled();
  });

  it("returns null data as null", async () => {
    const { deps } = setup({ result: { ok: true, data: undefined } });
    const res = await handleBrainAction(post("whoami"), "whoami", deps);
    expect(await body(res)).toEqual({ ok: true, data: null });
  });
});

describe("X-Baumy-On-Behalf-Of", () => {
  it("runs a confirmed write as the housemate, with the asker as initiator", async () => {
    const { deps, runAction } = setup();
    const res = await handleBrainAction(
      post("acknowledge_reminder", {
        onBehalfOf: HOUSEMATE,
        confirmed: "1",
        body: JSON.stringify({ reminderId: STRANGER }),
      }),
      "acknowledge_reminder",
      deps,
    );
    expect(res.status).toBe(200);
    expect(deps.findHousemate).toHaveBeenCalledWith(HOUSEMATE);
    expect(runAction.mock.calls[0]![2].actor).toEqual({
      kind: "service",
      tokenName: "baumy-brain",
      telegramUserId: LINKED_TG,
      memberId: HOUSEMATE,
      initiatorMemberId: MEMBER,
    });
  });

  it("needs X-Baumy-Confirmed: 1 for any write on someone's behalf, safe ones too", async () => {
    const { deps, runAction } = setup();
    // Safe for the asker themself: no confirmation.
    const own = await handleBrainAction(
      post("acknowledge_reminder"),
      "acknowledge_reminder",
      deps,
    );
    expect(own.status).toBe(200);
    expect(runAction).toHaveBeenCalledTimes(1);
    for (const name of ["acknowledge_reminder", "create_note"]) {
      const res = await handleBrainAction(
        post(name, { onBehalfOf: HOUSEMATE }),
        name,
        deps,
      );
      expect(res.status).toBe(428);
      expect(await body(res)).toMatchObject({
        code: "CONFIRMATION_REQUIRED",
        message: expect.stringContaining("housemate"),
      });
    }
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it("runs a read on someone's behalf without confirmation", async () => {
    const { deps, runAction } = setup();
    const res = await handleBrainAction(
      post("get_pending_confirmations", { onBehalfOf: HOUSEMATE, key: null }),
      "get_pending_confirmations",
      deps,
    );
    expect(res.status).toBe(200);
    expect(runAction.mock.calls[0]![2].actor).toMatchObject({
      memberId: HOUSEMATE,
      initiatorMemberId: MEMBER,
    });
  });

  it("refuses a target who is not an active member of this household", async () => {
    const { deps, runAction } = setup();
    // Unknown, deactivated or in another household: findHousemate says null.
    const res = await handleBrainAction(
      post("create_note", { onBehalfOf: STRANGER, confirmed: "1" }),
      "create_note",
      deps,
    );
    expect(res.status).toBe(404);
    expect(await body(res)).toMatchObject({ code: "NOT_FOUND" });
    for (const bad of ["not-a-uuid", "tg:1001", "12345"]) {
      const r = await handleBrainAction(
        post("create_note", { onBehalfOf: bad, confirmed: "1" }),
        "create_note",
        deps,
      );
      expect(r.status).toBe(400);
      expect(await body(r)).toMatchObject({
        code: "INVALID_INPUT",
        issues: [{ path: ["x-baumy-on-behalf-of"] }],
      });
    }
    expect(runAction).not.toHaveBeenCalled();
  });

  it("treats the asker's own id, in any case, as no on-behalf at all", async () => {
    const { deps, runAction } = setup();
    for (const own of [MEMBER, MEMBER.toUpperCase()]) {
      const res = await handleBrainAction(
        post("create_reminder", {
          onBehalfOf: own,
          body: JSON.stringify({ title: "Hi" }),
        }),
        "create_reminder",
        deps,
      );
      // A safe write for the asker: no confirmation needed.
      expect(res.status).toBe(200);
    }
    for (const call of runAction.mock.calls) {
      expect(call[2].actor).toEqual({
        kind: "service",
        tokenName: "baumy-brain",
        telegramUserId: LINKED_TG,
        memberId: MEMBER,
      });
    }
    // An upper-cased housemate id is still that housemate.
    const res = await handleBrainAction(
      post("create_reminder", {
        onBehalfOf: HOUSEMATE.toUpperCase(),
        confirmed: "1",
      }),
      "create_reminder",
      deps,
    );
    expect(res.status).toBe(200);
    expect(runAction.mock.calls[2]![2].actor).toMatchObject({
      memberId: HOUSEMATE,
      initiatorMemberId: MEMBER,
    });
  });

  it("refuses it for link_telegram and for actions that name their member in the input", async () => {
    const { deps, runAction } = setup();
    const done = await handleBrainAction(
      post("log_completion", { onBehalfOf: HOUSEMATE, confirmed: "1" }),
      "log_completion",
      deps,
    );
    expect(done.status).toBe(400);
    expect(await body(done)).toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("doneBy"),
    });
    for (const actor of [`tg:${LINKED_TG}`, `tg:${UNLINKED_TG}`]) {
      const link = await handleBrainAction(
        post("link_telegram", {
          actor,
          onBehalfOf: HOUSEMATE,
          body: JSON.stringify({ code: "ABCDEFGH23" }),
        }),
        "link_telegram",
        deps,
      );
      expect(link.status).toBe(400);
    }
    expect(runAction).not.toHaveBeenCalled();
  });

  it("still refuses an unlinked asker before looking at the header", async () => {
    const { deps } = setup();
    const res = await handleBrainAction(
      post("create_note", {
        actor: `tg:${UNLINKED_TG}`,
        onBehalfOf: HOUSEMATE,
        confirmed: "1",
      }),
      "create_note",
      deps,
    );
    expect(res.status).toBe(403);
    expect(await body(res)).toMatchObject({ code: "TELEGRAM_NOT_LINKED" });
    expect(deps.findHousemate).not.toHaveBeenCalled();
  });

  it("does not open admin actions on anyone's behalf", async () => {
    const { deps } = setup();
    const res = await handleBrainAction(
      post("manage_members", { onBehalfOf: HOUSEMATE, confirmed: "1" }),
      "manage_members",
      deps,
    );
    expect(res.status).toBe(403);
    expect(await body(res)).toMatchObject({ code: "SURFACE_FORBIDDEN" });
  });
});

describe("helpers", () => {
  it("parses the bearer and the actor header", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(parseActor("tg:123")).toBe(123);
    expect(parseActor(" tg:5000000001 ")).toBe(5000000001);
    expect(parseActor("tg:0")).toBeNull();
    expect(parseActor("tg:1 2")).toBeNull();
    expect(parseActor(null)).toBeNull();
  });

  it("says which requests need confirmation", () => {
    expect(needsConfirmation({ kind: "read", risk: "safe" }, false)).toBe(
      false,
    );
    expect(needsConfirmation({ kind: "read", risk: "safe" }, true)).toBe(false);
    expect(needsConfirmation({ kind: "write", risk: "safe" }, false)).toBe(
      false,
    );
    expect(needsConfirmation({ kind: "write", risk: "safe" }, true)).toBe(true);
    expect(needsConfirmation({ kind: "write", risk: "confirm" }, false)).toBe(
      true,
    );
    expect(
      needsConfirmation({ kind: "write", risk: "destructive" }, false),
    ).toBe(true);
  });

  it("maps codes to statuses, domain refusals to 422", () => {
    expect(statusFor("UNAUTHENTICATED")).toBe(401);
    expect(statusFor("TELEGRAM_NOT_LINKED")).toBe(403);
    expect(statusFor("IDEMPOTENCY_CONFLICT")).toBe(409);
    expect(statusFor("NOT_CONFIGURED")).toBe(503);
    expect(statusFor("LINK_CODE_INVALID")).toBe(422);
    expect(statusFor("TELEGRAM_ALREADY_LINKED")).toBe(422);
  });
});
