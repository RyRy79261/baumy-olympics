// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { challengeWindowEndsAt, PHOTO_RETENTION_DAYS } from "@baumy/core";
import type { Queryable } from "@baumy/db";
import { logCompletion } from "@baumy/db/completions";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  hashMcpSecret,
  insertMcpClient,
  insertMcpTokens,
} from "@baumy/db/mcp-oauth";
import { insertNote, softDeleteNote } from "@baumy/db/notes";
import {
  account,
  actionRequests,
  aiUsage,
  auditEvents,
  mcpAccessTokens,
  passkey,
  session,
  user,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor, MemberActor } from "@/lib/auth";
import { toolSpecs } from "@/lib/actions/tool-specs";
import { RETENTION } from "@/lib/privacy/retention";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { MyDataView } from "./get-my-data";
import { runAction } from "./registry";

// get_my_data (issue #144) through the real runAction on PGlite. Two members
// are seeded with different amounts of everything, so a count that leaked
// the other member's rows would be wrong; each expected number is read from
// the fixture that seeded it.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const IP = "203.0.113.77";

beforeEach(() => {
  __resetMemoryRateLimits();
});

interface Fixture {
  name: string;
  twoFactor: boolean;
  providers: string[];
  passkeys: number;
  /** Hours since each session was last used. */
  sessions: number[];
  liveNotes: number;
  deletedNotes: number;
  /** Rows where they are the actor. */
  audit: number;
  commands: { input: number; output: number }[];
  voice: number[];
  apps: string[];
  telegram: number | null;
}

const MINE: Fixture = {
  name: "Mine",
  twoFactor: true,
  providers: ["credential", "google"],
  passkeys: 2,
  sessions: [1, 30],
  liveNotes: 2,
  deletedNotes: 1,
  audit: 3,
  commands: [
    { input: 120, output: 30 },
    { input: 80, output: 10 },
  ],
  voice: [2.5],
  apps: ["Claude"],
  telegram: 4242,
};

const THEIRS: Fixture = {
  name: "Theirs",
  twoFactor: false,
  providers: ["credential"],
  passkeys: 1,
  sessions: [2, 3, 4],
  liveNotes: 4,
  deletedNotes: 3,
  audit: 6,
  commands: [{ input: 999, output: 999 }],
  voice: [9, 9],
  apps: ["Other app", "Third app"],
  telegram: null,
};

let seq = 0;

async function seedPerson(f: Fixture): Promise<MemberActor> {
  const memberId = await seedMember(db(), {
    displayName: f.name,
    telegramUserId: f.telegram,
  });
  const userId = `u_${memberId}`;
  await t
    .db()
    .insert(user)
    .values({
      id: userId,
      name: f.name,
      email: `${memberId}@example.com`,
      emailVerified: true,
      twoFactorEnabled: f.twoFactor,
    });
  for (const providerId of f.providers) {
    await t
      .db()
      .insert(account)
      .values({
        id: `${userId}-${providerId}`,
        accountId: userId,
        providerId,
        userId,
      });
  }
  for (let i = 0; i < f.passkeys; i++) {
    await t
      .db()
      .insert(passkey)
      .values({
        id: `${userId}-pk${i}`,
        publicKey: "pk",
        userId,
        credentialID: `${userId}-cred${i}`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      });
  }
  for (const [i, hours] of f.sessions.entries()) {
    const at = new Date(FIXED_NOW.getTime() - hours * HOUR);
    await t
      .db()
      .insert(session)
      .values({
        id: `${userId}-s${i}`,
        token: `${userId}-tok${i}`,
        userId,
        ipAddress: IP,
        userAgent: UA,
        createdAt: at,
        updatedAt: at,
        expiresAt: new Date(FIXED_NOW.getTime() + DAY),
      });
  }
  for (let i = 0; i < f.liveNotes + f.deletedNotes; i++) {
    const id = await insertNote(db(), {
      householdId: HOUSEHOLD_ID,
      authorId: memberId,
      title: `${f.name} secret note ${i}`,
      bodyMd: `${f.name} secret body`,
      color: null,
      pinned: false,
      now: FIXED_NOW,
    });
    if (i < f.deletedNotes) {
      await softDeleteNote(db(), {
        householdId: HOUSEHOLD_ID,
        id,
        now: FIXED_NOW,
      });
    }
  }
  for (let i = 0; i < f.audit; i++) {
    await t
      .db()
      .insert(auditEvents)
      .values({
        actorMemberId: memberId,
        source: "ui",
        action: "create_note",
        entity: "note",
        payload: { title: `${f.name} secret payload` },
        at: FIXED_NOW,
      });
  }
  for (const c of f.commands) {
    await t.db().insert(aiUsage).values({
      householdId: HOUSEHOLD_ID,
      memberId,
      provider: "anthropic",
      inputTokens: c.input,
      outputTokens: c.output,
      at: FIXED_NOW,
    });
  }
  for (const s of f.voice) {
    await t.db().insert(aiUsage).values({
      householdId: HOUSEHOLD_ID,
      memberId,
      provider: "groq",
      audioSeconds: s,
      at: FIXED_NOW,
    });
  }
  for (const name of f.apps) {
    seq += 1;
    const clientId = `client_${seq}`;
    await insertMcpClient(db(), {
      clientId,
      clientSecretHash: null,
      clientName: name,
      redirectUris: ["https://example.com/cb"],
      tokenEndpointAuthMethod: "none",
      now: FIXED_NOW,
    });
    await insertMcpTokens(db(), {
      grantId: crypto.randomUUID(),
      tokenHash: hashMcpSecret(`at-${seq}`),
      refreshTokenHash: hashMcpSecret(`rt-${seq}`),
      clientId,
      memberId,
      scopes: ["baumy:read"],
      grantedAt: FIXED_NOW,
      now: FIXED_NOW,
    });
  }
  return sessionActor(memberId, "member", {
    userId,
    sessionId: `${userId}-s0`,
  });
}

let claimSeq = 0;
async function claim(
  choreId: string,
  doneBy: string,
  when: Date,
  photo: string | null,
) {
  claimSeq += 1;
  const r = await t.db().transaction((tx) =>
    logCompletion(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy,
      loggedBy: doneBy,
      occurredAt: when,
      now: when,
      source: "ui",
      clientRequestId: `get-my-data-${claimSeq}`,
      photoPathname: photo,
    }),
  );
  if (!r.ok) throw new Error(`log failed: ${r.code}`);
  return r.completion;
}

/** Both members, and the completions: two of mine (one settled), one theirs. */
async function arrange() {
  const me = await seedPerson(MINE);
  const them = await seedPerson(THEIRS);
  const trash = await seedChore(db(), SEED_CHORES.trash);
  const dishes = await seedChore(db(), SEED_CHORES.dishes);
  await claim(
    dishes.choreId,
    them.memberId!,
    new Date(FIXED_NOW.getTime() - 4 * DAY),
    "completions/theirs/x.webp",
  );
  const settled = await claim(
    trash.choreId,
    me.memberId!,
    new Date(FIXED_NOW.getTime() - 3 * DAY),
    "completions/mine/settled.webp",
  );
  const open = await claim(
    dishes.choreId,
    me.memberId!,
    new Date(FIXED_NOW.getTime() - HOUR),
    "completions/mine/open.webp",
  );
  return { me, them, settled, open };
}

const get = (actor: Actor, over: Parameters<typeof ctxFor>[1] = {}) =>
  runAction("get_my_data", {}, ctxFor(actor, over));

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("get_my_data", () => {
  it("counts the caller's own data, matching what was seeded", async () => {
    const { me, settled, open } = await arrange();
    const res = await get(me);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data: MyDataView = res.data;

    expect(data.account).toEqual({
      emailVerified: true,
      hasPassword: MINE.providers.includes("credential"),
      googleLinked: MINE.providers.includes("google"),
      passkeys: MINE.passkeys,
      twoFactorEnabled: MINE.twoFactor,
    });
    expect(data.sessions).toEqual({
      count: MINE.sessions.length,
      lastUsedAt: MINE.sessions.map((h) =>
        new Date(FIXED_NOW.getTime() - h * HOUR).toISOString(),
      ),
    });
    expect(data.profile).toMatchObject({
      displayName: MINE.name,
      role: "member",
      characterPicked: false,
      kioskPinSet: false,
      telegramLinked: MINE.telegram !== null,
    });
    expect(data.completions).toEqual({
      total: 2,
      byStatus: {
        pending: 1,
        confirmed: 0,
        finalized: 1,
        disputed: 0,
        voided: 0,
      },
    });
    expect(data.notes).toEqual({
      written: MINE.liveNotes + MINE.deletedNotes,
      deletedKept: MINE.deletedNotes,
    });
    expect(data.photos).toEqual({
      stored: 2,
      items: [
        {
          attachedAt: settled.photoAttachedAt!.toISOString(),
          deletesAt: new Date(
            challengeWindowEndsAt(settled).getTime() +
              PHOTO_RETENTION_DAYS * DAY,
          ).toISOString(),
        },
        { attachedAt: open.photoAttachedAt!.toISOString(), deletesAt: null },
      ],
    });
    expect(data.auditEntries).toBe(MINE.audit);
    expect(data.ai).toEqual({
      commands: MINE.commands.length,
      inputTokens: sum(MINE.commands.map((c) => c.input)),
      outputTokens: sum(MINE.commands.map((c) => c.output)),
      voiceClips: MINE.voice.length,
      voiceSeconds: sum(MINE.voice),
      lastUsedAt: FIXED_NOW.toISOString(),
    });
    expect(data.connectedApps).toEqual(
      MINE.apps.map((name) => ({
        name,
        connectedAt: FIXED_NOW.toISOString(),
        lastUsedAt: null,
      })),
    );
    expect(data.retention).toEqual(RETENTION);
    expect(data.retention.photoDays).toBe(PHOTO_RETENTION_DAYS);
  });

  it("never includes another member's rows, an IP, a user agent or anything written", async () => {
    const { me, them } = await arrange();
    const mine = await get(me);
    const theirs = await get(them);
    expect(mine.ok && theirs.ok).toBe(true);
    if (!mine.ok || !theirs.ok) return;
    // Each sees their own numbers, not the other's or a sum of both.
    expect(theirs.data.profile.displayName).toBe(THEIRS.name);
    expect(theirs.data.sessions.count).toBe(THEIRS.sessions.length);
    expect(theirs.data.notes.written).toBe(
      THEIRS.liveNotes + THEIRS.deletedNotes,
    );
    expect(theirs.data.auditEntries).toBe(THEIRS.audit);
    expect(theirs.data.ai.commands).toBe(THEIRS.commands.length);
    // Same grant time, so the order between them is the grant id's.
    expect(theirs.data.connectedApps.map((a) => a.name).sort()).toEqual(
      [...THEIRS.apps].sort(),
    );
    expect(theirs.data.completions.total).toBe(1);

    const json = JSON.stringify(mine.data);
    expect(json).toContain(MINE.name);
    for (const leak of [
      THEIRS.name,
      them.memberId!,
      ...THEIRS.apps,
      IP,
      UA,
      "Chrome",
      "secret",
      "completions/",
      "@example.com",
    ]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it("has no member field: asking about someone else is refused", async () => {
    const { me, them } = await arrange();
    const res = await runAction(
      "get_my_data",
      { memberId: them.memberId } as never,
      ctxFor(me),
    );
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("needs the member's own session: the kiosk, MCP, brain and no member are refused", async () => {
    const { me } = await arrange();
    const memberId = me.memberId!;
    const others: [Actor, string][] = [
      [kioskActor(memberId), "kiosk"],
      [kioskActor(), "kiosk, nobody picked"],
      [{ kind: "mcp", memberId, scopes: ["baumy:read"] }, "mcp"],
      [{ kind: "service", tokenName: "baumy-brain", memberId }, "brain"],
      [sessionActor(undefined), "no member"],
    ];
    for (const [actor, label] of others) {
      const res = await get(actor, { source: "ai" });
      expect(res, label).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    // The same member on their own session gets it.
    expect((await get(me, { source: "ai" })).ok).toBe(true);
  });

  it("runs on the ui and ai surfaces only", async () => {
    const { me } = await arrange();
    for (const source of ["kiosk", "mcp", "brain"] as const) {
      const res = await get(me, { source });
      expect(res, source).toMatchObject({
        ok: false,
        code: "SURFACE_FORBIDDEN",
      });
    }
    expect((await get(me, { source: "ui" })).ok).toBe(true);
    expect(toolSpecs("ai").map((s) => s.name)).toContain("get_my_data");
    for (const surface of ["kiosk", "mcp", "brain"] as const) {
      expect(toolSpecs(surface).map((s) => s.name)).not.toContain(
        "get_my_data",
      );
    }
  });

  it("writes nothing to the audit log or the ledger", async () => {
    const { me } = await arrange();
    const before = await t.db().select().from(auditEvents);
    expect(before.length).toBeGreaterThan(0);
    expect((await get(me)).ok).toBe(true);
    expect(await t.db().select().from(auditEvents)).toHaveLength(before.length);
    expect(await t.db().select().from(actionRequests)).toEqual([]);
  });

  it("only reads the member row in the request's household", async () => {
    const { me } = await arrange();
    expect((await get(me)).ok).toBe(true);
    const res = await get(me, { householdId: crypto.randomUUID() });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("answers zeros for a member with nothing yet, and dates an app's last use", async () => {
    const memberId = await seedMember(db(), { displayName: "Newcomer" });
    await insertMcpClient(db(), {
      clientId: "client_used",
      clientSecretHash: null,
      clientName: "Used app",
      redirectUris: ["https://example.com/cb"],
      tokenEndpointAuthMethod: "none",
      now: FIXED_NOW,
    });
    await insertMcpTokens(db(), {
      grantId: crypto.randomUUID(),
      tokenHash: hashMcpSecret("at-used"),
      refreshTokenHash: hashMcpSecret("rt-used"),
      clientId: "client_used",
      memberId,
      scopes: ["baumy:read"],
      grantedAt: FIXED_NOW,
      now: FIXED_NOW,
    });
    await t
      .db()
      .update(mcpAccessTokens)
      .set({ lastUsedAt: FIXED_NOW })
      .where(eq(mcpAccessTokens.memberId, memberId));
    // No auth `user` row behind the session: every flag reads false.
    const res = await get(sessionActor(memberId));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.account).toEqual({
      emailVerified: false,
      hasPassword: false,
      googleLinked: false,
      passkeys: 0,
      twoFactorEnabled: false,
    });
    expect(res.data.sessions).toEqual({ count: 0, lastUsedAt: [] });
    expect(res.data.completions.total).toBe(0);
    expect(res.data.notes).toEqual({ written: 0, deletedKept: 0 });
    expect(res.data.photos).toEqual({ stored: 0, items: [] });
    expect(res.data.auditEntries).toBe(0);
    expect(res.data.ai).toMatchObject({ commands: 0, lastUsedAt: null });
    expect(res.data.connectedApps).toEqual([
      {
        name: "Used app",
        connectedAt: FIXED_NOW.toISOString(),
        lastUsedAt: FIXED_NOW.toISOString(),
      },
    ]);
  });

  it("says so when the member row is gone", async () => {
    const res = await get(sessionActor(crypto.randomUUID()));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
