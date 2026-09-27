import { eq } from "drizzle-orm";
import { z } from "zod";
import { members } from "@baumy/db/schema";
import { defineAction } from "./define";
import { fail } from "./result";

export const DISPLAY_NAME_MAX = 40;

const input = z
  .strictObject({
    displayName: z
      .string()
      .trim()
      .min(1, "Enter a name.")
      .max(DISPLAY_NAME_MAX, `Keep it to ${DISPLAY_NAME_MAX} characters.`)
      .optional()
      .describe("The name housemates see."),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #ff8800.")
      .transform((c) => c.toLowerCase())
      .optional()
      .describe("Your colour on the scoreboard, as #rrggbb."),
  })
  .refine((v) => v.displayName !== undefined || v.color !== undefined, {
    message: "Change your name or your colour.",
  });

export interface UpdateMyProfileData {
  memberId: string;
  displayName: string;
  color: string;
}

export const updateMyProfile = defineAction({
  name: "update_my_profile",
  title: "Update my profile",
  description:
    "Changes the signed-in member's own display name and/or colour. Only from their own signed-in session.",
  consent: "Change your own display name and colour",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input,
  async execute(ctx, changes) {
    const memberId = ctx.actor.memberId!;
    const [row] = await ctx.db
      .update(members)
      .set(changes)
      .where(eq(members.id, memberId))
      .returning({
        memberId: members.id,
        displayName: members.displayName,
        color: members.color,
      });
    if (!row) return fail("NOT_FOUND", "Your member profile was not found.");
    const data: UpdateMyProfileData = row;
    return {
      ok: true,
      data,
      audit: { entity: "member", entityId: memberId, payload: changes },
    };
  },
});
