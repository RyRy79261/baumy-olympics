import { eq } from "drizzle-orm";
import { z } from "zod";
import type { CompletionStatus } from "@baumy/core";
import {
  findAuthUser,
  listUserSessions,
  signInMethods,
} from "@baumy/db/account-security";
import { listMcpConnections } from "@baumy/db/mcp-oauth";
import {
  countAuditEntriesNaming,
  myAiUsage,
  myCompletions,
  myNoteCounts,
} from "@baumy/db/my-data";
import { members } from "@baumy/db/schema";
import type { MemberActor } from "@/lib/auth";
import { RETENTION, type RetentionRules } from "@/lib/privacy/retention";
import { GOOGLE_PROVIDER } from "./account-security";
import { defineAction } from "./define";
import { fail } from "./result";

// "What do you keep about me?" (issue #144): a self-only read. It needs the
// member's OWN session (`session`: never the kiosk, where the room would see
// it, nor MCP or brain), and has no member field, so it only ever answers
// about the caller. It returns counts and dates, never text anyone wrote,
// never an IP address or a user agent, and nothing about anyone else. The
// retention rules come from lib/privacy/retention.ts, the privacy page's own
// numbers.

export interface MyDataView {
  account: {
    emailVerified: boolean;
    hasPassword: boolean;
    googleLinked: boolean;
    passkeys: number;
    twoFactorEnabled: boolean;
  };
  /** Signed-in devices: when each was last used, most recent first. */
  sessions: { count: number; lastUsedAt: string[] };
  profile: {
    displayName: string;
    color: string;
    role: "admin" | "member";
    memberSince: string;
    characterPicked: boolean;
    kioskPinSet: boolean;
    telegramLinked: boolean;
  };
  completions: { total: number; byStatus: Record<CompletionStatus, number> };
  notes: { written: number; deletedKept: number };
  /** `deletesAt` is null while the claim is still open. */
  photos: {
    stored: number;
    items: { attachedAt: string; deletesAt: string | null }[];
  };
  auditEntries: number;
  ai: {
    commands: number;
    inputTokens: number;
    outputTokens: number;
    voiceClips: number;
    voiceSeconds: number;
    lastUsedAt: string | null;
  };
  connectedApps: {
    name: string;
    connectedAt: string;
    lastUsedAt: string | null;
  }[];
  retention: RetentionRules;
}

const iso = (d: Date) => d.toISOString();

export const getMyData = defineAction({
  name: "get_my_data",
  title: "What Baumy keeps about me",
  description:
    "What the app stores about the member asking, as counts and dates: how they sign in, their signed-in devices, their profile, their completions, notes (deleted ones are kept), proof photos and when each is deleted, audit-log entries naming them, their AI usage and connected apps, plus the retention rules. Only ever about the asker; it never shows IP addresses or anyone else's data. Use it for 'what do you keep about me?'.",
  consent: "See a summary of what Baumy keeps about you",
  kind: "read",
  risk: "safe",
  surfaces: ["ui", "ai"],
  requires: "session",
  input: z.strictObject({}),
  async execute(ctx) {
    // The session gate has checked it is a member's own session.
    const { userId, memberId } = ctx.actor as MemberActor & {
      memberId: string;
    };
    const scope = { householdId: ctx.householdId, memberId };
    const [
      [me],
      flags,
      methods,
      sessions,
      game,
      noteCounts,
      auditEntries,
      ai,
      apps,
    ] = await Promise.all([
      ctx.db
        .select({
          displayName: members.displayName,
          color: members.color,
          role: members.role,
          createdAt: members.createdAt,
          avatarImageId: members.avatarImageId,
          kioskPinHash: members.kioskPinHash,
          telegramUserId: members.telegramUserId,
        })
        .from(members)
        .where(eq(members.id, memberId)),
      findAuthUser(ctx.db, userId),
      signInMethods(ctx.db, userId),
      listUserSessions(ctx.db, userId, ctx.now),
      myCompletions(ctx.db, { ...scope, now: ctx.now }),
      myNoteCounts(ctx.db, scope),
      countAuditEntriesNaming(ctx.db, memberId),
      myAiUsage(ctx.db, scope),
      listMcpConnections(ctx.db, memberId, ctx.now),
    ]);
    if (!me) return fail("NOT_FOUND", "Your member profile was not found.");
    const data: MyDataView = {
      account: {
        emailVerified: flags?.emailVerified ?? false,
        hasPassword: methods.password,
        googleLinked: methods.providers.includes(GOOGLE_PROVIDER),
        passkeys: methods.passkeys,
        twoFactorEnabled: flags?.twoFactorEnabled ?? false,
      },
      sessions: {
        count: sessions.length,
        lastUsedAt: sessions.map((s) => iso(s.updatedAt)),
      },
      profile: {
        displayName: me.displayName,
        color: me.color,
        role: me.role,
        memberSince: iso(me.createdAt),
        characterPicked: me.avatarImageId !== null,
        kioskPinSet: me.kioskPinHash !== null,
        telegramLinked: me.telegramUserId !== null,
      },
      completions: game.completions,
      notes: noteCounts,
      photos: {
        stored: game.photos.length,
        items: game.photos.map((p) => ({
          attachedAt: iso(p.attachedAt),
          deletesAt: p.deletesAt ? iso(p.deletesAt) : null,
        })),
      },
      auditEntries,
      ai: {
        ...ai,
        lastUsedAt: ai.lastUsedAt ? iso(ai.lastUsedAt) : null,
      },
      connectedApps: apps.map((a) => ({
        name: a.clientName,
        connectedAt: iso(a.grantedAt),
        lastUsedAt: a.lastUsedAt ? iso(a.lastUsedAt) : null,
      })),
      retention: RETENTION,
    };
    return { ok: true, data };
  },
});
