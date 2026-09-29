import { describe, expect, it } from "vitest";
import { avatarImageView, avatarPathAvatarId, avatarPathname } from "./paths";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("avatar paths", () => {
  it("round-trips a sprite's pathname to its id", () => {
    const p = avatarPathname(ID, "a1b2c3d4e5f60718");
    expect(p).toBe(`avatars/${ID}/a1b2c3d4e5f60718.png`);
    expect(avatarPathAvatarId(p)).toBe(ID);
  });

  it("allows nothing else: other types, other folders, escapes", () => {
    for (const p of [
      `avatars/${ID}/a1b2c3d4e5f60718.svg`,
      `avatars/${ID}/short.png`,
      `avatars/${ID}/../a1b2c3d4e5f60718.png`,
      `avatars/${ID}/a1b2c3d4%2e.png`,
      `completions/${ID}/a1b2c3d4e5f60718.png`,
      `avatars/not-a-uuid/a1b2c3d4e5f60718.png`,
    ]) {
      expect(avatarPathAvatarId(p)).toBeNull();
    }
  });

  it("draws a stored set through the proxy only, missing poses null", () => {
    const pose = (n: string) => ({
      pathname: `avatars/x/${n}.png`,
      width: 28,
      height: 56,
    });
    const view = (n: string) => ({
      src: `/api/blob?pathname=avatars%2Fx%2F${n}.png`,
      width: 28,
      height: 56,
    });
    expect(avatarImageView({ poses: { idle: pose("i") } })).toEqual({
      idle: view("i"),
      walk: null,
      emote: null,
    });
    expect(
      avatarImageView({
        poses: { idle: pose("i"), walk: pose("w"), emote: pose("e") },
      }),
    ).toEqual({ idle: view("i"), walk: view("w"), emote: view("e") });
    expect(avatarImageView(null)).toBeNull();
  });
});
