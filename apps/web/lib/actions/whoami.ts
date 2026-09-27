import { eq } from "drizzle-orm";
import { z } from "zod";
import { members } from "@baumy/db/schema";
import { defineAction } from "./define";
import { fail } from "./result";

export interface WhoamiData {
  memberId: string;
  displayName: string;
  role: "admin" | "member";
  color: string;
  avatarSprite: string;
  /** How this request is authenticated: a session, the kiosk, MCP or brain. */
  actorKind: "member" | "kiosk" | "service" | "mcp";
}

export const whoami = defineAction({
  name: "whoami",
  title: "Who am I",
  description:
    "Returns the household member making this request: their member id, display name, role (admin or member), colour and avatar sprite. Use it to learn who 'me' is before acting for them.",
  consent: "Your name, role and colour in the household",
  kind: "read",
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  requires: "member",
  input: z.strictObject({}),
  async execute(ctx) {
    const [row] = await ctx.db
      .select({
        memberId: members.id,
        displayName: members.displayName,
        role: members.role,
        color: members.color,
        avatarSprite: members.avatarSprite,
      })
      .from(members)
      // The member gate has checked memberId is set.
      .where(eq(members.id, ctx.actor.memberId!));
    if (!row) return fail("NOT_FOUND", "Your member profile was not found.");
    const data: WhoamiData = { ...row, actorKind: ctx.actor.kind };
    return { ok: true, data };
  },
});
