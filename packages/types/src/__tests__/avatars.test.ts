import { describe, expect, it } from "vitest";
import {
  AVATAR_NAME_MAX,
  AvatarRef,
  ChooseAvatar,
  JoinAvatarId,
  NewAvatar,
} from "../avatars";

const ID = "3f6c0e1a-2b4d-4c8e-9f10-1a2b3c4d5e6f";

describe("NewAvatar", () => {
  it("trims the name and refuses a blank or overlong one", () => {
    expect(NewAvatar.parse({ name: "  Knight " })).toEqual({ name: "Knight" });
    expect(NewAvatar.safeParse({ name: " " }).error?.issues[0]).toMatchObject({
      path: ["name"],
      message: "Give it a name.",
    });
    expect(
      NewAvatar.safeParse({ name: "x".repeat(AVATAR_NAME_MAX + 1) }).success,
    ).toBe(false);
    expect(NewAvatar.safeParse({ name: "K", pathname: "x" }).success).toBe(
      false,
    );
  });
});

describe("AvatarRef and ChooseAvatar", () => {
  it("takes a gallery id", () => {
    expect(AvatarRef.parse({ avatarId: ID })).toEqual({ avatarId: ID });
    expect(
      AvatarRef.safeParse({ avatarId: "x" }).error?.issues[0],
    ).toMatchObject({ message: "Pick a character from the gallery." });
  });

  it("reads an empty form value, or null, as the drawn character", () => {
    expect(ChooseAvatar.parse({ avatarId: ID })).toEqual({ avatarId: ID });
    expect(ChooseAvatar.parse({ avatarId: "" })).toEqual({ avatarId: null });
    expect(ChooseAvatar.parse({ avatarId: null })).toEqual({ avatarId: null });
    expect(ChooseAvatar.safeParse({}).success).toBe(false);
    expect(ChooseAvatar.safeParse({ avatarId: "nope" }).success).toBe(false);
  });

  it("makes the pick on /join optional", () => {
    expect(JoinAvatarId.parse(undefined)).toBeUndefined();
    expect(JoinAvatarId.parse("")).toBeNull();
    expect(JoinAvatarId.parse(ID)).toBe(ID);
  });
});
