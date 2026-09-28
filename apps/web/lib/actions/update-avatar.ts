import { updateMember } from "@baumy/db/members";
import { MemberAvatar } from "@baumy/types";
import { defineAction } from "./define";
import { fail } from "./result";

// A member's 16-bit character (ADR 0005 §5), chosen in Settings: hair style,
// hair colour, skin tone and shirt colour. Everyone has a default picked
// from their id (`defaultAvatar`), so choosing is optional. Only from the
// member's own signed-in session, like `update_my_profile`.

export interface UpdateAvatarData {
  memberId: string;
  avatar: MemberAvatar;
}

export const updateAvatar = defineAction({
  name: "update_avatar",
  title: "Choose my character",
  description:
    "Sets the signed-in member's own 16-bit character: hair style, hair colour, skin tone and shirt colour. Only from their own signed-in session.",
  consent: "Change your own character",
  kind: "write",
  risk: "safe",
  surfaces: ["ui"],
  requires: "session",
  input: MemberAvatar,
  async execute(ctx, avatar) {
    const memberId = ctx.actor.memberId!;
    const row = await updateMember(ctx.db, memberId, { avatar });
    if (!row) return fail("NOT_FOUND", "Your member profile was not found.");
    const data: UpdateAvatarData = { memberId, avatar };
    return {
      ok: true,
      data,
      audit: { entity: "member", entityId: memberId },
    };
  },
});
