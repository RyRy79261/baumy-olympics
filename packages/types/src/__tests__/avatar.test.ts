import { describe, expect, it } from "vitest";
import {
  AVATAR_HAIR_COLORS,
  AVATAR_HAIR_STYLES,
  AVATAR_SHIRT_COLORS,
  AVATAR_SKIN_TONES,
  MemberAvatar,
  avatarFor,
  defaultAvatar,
} from "../member";

const CHOSEN = {
  hairStyle: "spiky",
  hairColor: "auburn",
  skinTone: "tan",
  shirtColor: "violet",
} as const;

const ids = Array.from(
  { length: 40 },
  (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
);

describe("MemberAvatar", () => {
  it("accepts a whole character made of the offered ids", () => {
    expect(MemberAvatar.parse(CHOSEN)).toEqual(CHOSEN);
  });

  it("refuses an id the art does not have, a missing part and extras", () => {
    const bad = MemberAvatar.safeParse({ ...CHOSEN, hairColor: "green" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]).toMatchObject({
      path: ["hairColor"],
      message: "Pick one of the hair colours.",
    });
    const { shirtColor: _, ...partial } = CHOSEN;
    expect(MemberAvatar.safeParse(partial).success).toBe(false);
    expect(MemberAvatar.safeParse({ ...CHOSEN, hat: "cap" }).success).toBe(
      false,
    );
  });
});

describe("defaultAvatar", () => {
  it("is a valid character, the same every time for one member", () => {
    for (const id of ids) {
      const a = defaultAvatar(id);
      expect(MemberAvatar.parse(a)).toEqual(a);
      expect(defaultAvatar(id)).toEqual(a);
    }
  });

  it("spreads housemates over every option", () => {
    const all = ids.map(defaultAvatar);
    expect(new Set(all.map((a) => a.hairStyle)).size).toBe(
      AVATAR_HAIR_STYLES.length,
    );
    expect(new Set(all.map((a) => a.hairColor)).size).toBe(
      AVATAR_HAIR_COLORS.length,
    );
    expect(new Set(all.map((a) => a.skinTone)).size).toBe(
      AVATAR_SKIN_TONES.length,
    );
    expect(new Set(all.map((a) => a.shirtColor)).size).toBe(
      AVATAR_SHIRT_COLORS.length,
    );
  });
});

describe("avatarFor", () => {
  it("is the member's own choice when they made one", () => {
    expect(avatarFor({ id: ids[0]!, avatar: CHOSEN })).toEqual(CHOSEN);
  });

  it("falls back to the default for none, or an id the art dropped", () => {
    expect(avatarFor({ id: ids[1]!, avatar: null })).toEqual(
      defaultAvatar(ids[1]!),
    );
    expect(
      avatarFor({ id: ids[2]!, avatar: { ...CHOSEN, hairStyle: "mohawk" } }),
    ).toEqual(defaultAvatar(ids[2]!));
  });
});
