import { describe, expect, it } from "vitest";
import {
  AVATAR_HAIR_COLORS,
  AVATAR_HAIR_STYLES,
  AVATAR_SHIRT_COLORS,
  AVATAR_SKIN_TONES,
  MemberAvatar,
  avatarFor,
  defaultAvatar,
  rosterAvatars,
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

describe("rosterAvatars", () => {
  const shirts = (m: Map<string, { shirtColor: string }>) =>
    [...m.values()].map((a) => a.shirtColor);

  it("gives members who have not chosen shirts nobody else wears", () => {
    // Any six ids: all six shirts, whatever their hashes say.
    for (let k = 0; k + 6 <= ids.length; k += 6) {
      const roster = ids.slice(k, k + 6).map((id) => ({ id, avatar: null }));
      expect(new Set(shirts(rosterAvatars(roster))).size).toBe(6);
    }
  });

  it("keeps each default but the shirt, and the earlier joiner's shirt", () => {
    // Two ids whose default shirts collide.
    const [a, b] = ids
      .flatMap((x, i) => ids.slice(i + 1).map((y) => [x, y] as const))
      .find(
        ([x, y]) => defaultAvatar(x).shirtColor === defaultAvatar(y).shirtColor,
      )!;
    const out = rosterAvatars([
      { id: a, avatar: null },
      { id: b, avatar: null },
    ]);
    expect(out.get(a)).toEqual(defaultAvatar(a));
    const bDefault = defaultAvatar(b);
    const next =
      AVATAR_SHIRT_COLORS[
        (AVATAR_SHIRT_COLORS.indexOf(bDefault.shirtColor) + 1) %
          AVATAR_SHIRT_COLORS.length
      ];
    expect(out.get(b)).toEqual({ ...bDefault, shirtColor: next });
  });

  it("keeps a chosen character, and steers defaults around its shirt", () => {
    const first = ids[0]!;
    const chooser = {
      id: ids[1]!,
      avatar: { ...CHOSEN, shirtColor: defaultAvatar(first).shirtColor },
    };
    const out = rosterAvatars([{ id: first, avatar: null }, chooser]);
    expect(out.get(ids[1]!)).toEqual(chooser.avatar);
    expect(out.get(first)!.shirtColor).not.toBe(
      defaultAvatar(first).shirtColor,
    );
  });

  it("lets defaults repeat only once every shirt is worn", () => {
    const roster = ids.slice(0, 8).map((id) => ({ id, avatar: null }));
    const out = rosterAvatars(roster);
    expect(new Set(shirts(out)).size).toBe(AVATAR_SHIRT_COLORS.length);
    expect(out.get(ids[7]!)).toEqual(defaultAvatar(ids[7]!));
  });
});
