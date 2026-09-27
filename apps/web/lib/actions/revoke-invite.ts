import { z } from "zod";
import { revokeInviteCode } from "@baumy/db/invite-codes";
import { defineAction } from "./define";
import { fail } from "./result";

// An admin cancels an invite code before it runs out (/admin/members). The
// people who already joined with it stay. Compare-and-set: only a code not
// already revoked.

export const revokeInvite = defineAction({
  name: "revoke_invite",
  title: "Cancel an invite code",
  description:
    "Cancels a household invite code so nobody else can join with it. Members who already joined stay.",
  consent: "Cancel household invite codes",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "admin",
  input: z.strictObject({
    code: z.string().trim().min(1, "Which code?").max(64),
  }),
  async execute(ctx, { code }) {
    const row = await revokeInviteCode(ctx.db, code, ctx.now);
    if (!row) {
      return fail(
        "NOT_FOUND",
        "That code doesn't exist or was already cancelled.",
      );
    }
    return {
      ok: true,
      data: { code: row.code },
      audit: { entity: "invite_code", entityId: row.code, payload: {} },
    };
  },
});
