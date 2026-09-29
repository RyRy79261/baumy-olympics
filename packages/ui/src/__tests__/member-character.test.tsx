import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarGallery } from "../avatar-gallery";
import { AvatarButton } from "../kiosk-shell";
import {
  HOUSEMATE_HEIGHT_PX,
  MemberCharacter,
  spriteFactor,
} from "../member-character";

// A member's gallery sprite (issue #111), drawn crisp at whole-number
// scales in the slot the drawn Housemate would fill.

const SPRITE = {
  src: "/api/blob?pathname=avatars%2Fx%2Fy.png",
  width: 28,
  height: 56,
};

const SET = { idle: SPRITE };
const pose = (name: string) => ({ ...SPRITE, src: `/${name}.png` });
const FULL = { idle: SPRITE, walk: pose("walk"), emote: pose("emote") };

describe("spriteFactor", () => {
  it("picks the whole-number multiple or fraction closest to the slot", () => {
    expect(spriteFactor(56, HOUSEMATE_HEIGHT_PX * 3)).toBe(1); // 51 → 56
    expect(spriteFactor(56, HOUSEMATE_HEIGHT_PX * 2)).toBe(1 / 2); // 34 → 28
    expect(spriteFactor(56, HOUSEMATE_HEIGHT_PX * 7)).toBe(2); // 119 → 112
    expect(spriteFactor(56, HOUSEMATE_HEIGHT_PX)).toBe(1 / 3); // 17 → 19
    expect(spriteFactor(14, 400)).toBe(8); // capped
  });
});

describe("MemberCharacter", () => {
  it("draws the sprite pixelated, sized to the slot, named when labelled", () => {
    const html = renderToStaticMarkup(
      <MemberCharacter sprites={SET} scale={7} label="Ryan" bob />,
    );
    expect(html).toContain('src="/api/blob?pathname=avatars%2Fx%2Fy.png"');
    expect(html).toContain('width="56"');
    expect(html).toContain('height="112"');
    expect(html).toContain("image-rendering:pixelated");
    expect(html).toContain('alt="Ryan"');
    expect(html).toContain("animate-pixel-bob");
    expect(html).not.toContain("data-housemate");
  });

  it("is decorative without a label", () => {
    const html = renderToStaticMarkup(<MemberCharacter sprites={SET} />);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  it("falls back to the drawn Housemate without a sprite", () => {
    const html = renderToStaticMarkup(
      <MemberCharacter sprites={null} memberId="m1" scale={2} />,
    );
    expect(html).toContain("data-housemate");
    expect(html).not.toContain("data-member-sprite");
  });

  it("holds a pose the set has, and idle for one it lacks", () => {
    const leader = renderToStaticMarkup(
      <MemberCharacter sprites={FULL} pose="emote" />,
    );
    expect(leader).toContain('src="/emote.png"');
    expect(leader).toContain('data-pose="emote"');
    expect(leader).not.toContain('data-pose="idle"');
    const lacking = renderToStaticMarkup(
      <MemberCharacter sprites={SET} pose="emote" />,
    );
    expect(lacking).toContain('data-pose="idle"');
    expect(lacking).not.toContain("emote");
  });

  it("plays the emote once over idle, and walks in only with motion allowed", () => {
    const emote = renderToStaticMarkup(
      <MemberCharacter sprites={FULL} moment="emote" />,
    );
    expect(emote).toContain('data-moment="emote"');
    expect(emote).toContain('data-pose="idle"');
    expect(emote).toMatch(/data-pose="emote"[^>]*animate-pose-flash/);
    const walk = renderToStaticMarkup(
      <MemberCharacter sprites={FULL} moment="walk-in" />,
    );
    expect(walk).toContain('data-moment="walk-in"');
    expect(walk).toMatch(
      /data-pose="walk"[^>]*hidden motion-safe:block motion-safe:animate-pose-walk-in/,
    );
    expect(walk).toMatch(
      /data-pose="idle"[^>]*motion-safe:animate-pose-after-walk/,
    );
    // A set with only idle has no moments: just idle.
    const plain = renderToStaticMarkup(
      <MemberCharacter sprites={SET} moment="walk-in" />,
    );
    expect(plain).toContain('data-pose="idle"');
    expect(plain).not.toContain("data-moment");
    expect(plain).not.toContain("animate-pose");
  });

  it("draws a given character instead in the kiosk's avatar button", () => {
    const html = renderToStaticMarkup(
      <AvatarButton
        displayName="Ryan"
        sprite="cat"
        color="#fff"
        memberId="m1"
        character={<i data-testid="custom" />}
      />,
    );
    expect(html).toContain('data-testid="custom"');
    expect(html).not.toContain("data-housemate");
  });

  it("is what the kiosk's avatar button draws", () => {
    const withSprite = renderToStaticMarkup(
      <AvatarButton
        displayName="Ryan"
        sprite="cat"
        color="#fff"
        memberId="m1"
        sprites={SET}
      />,
    );
    expect(withSprite).toContain("data-member-sprite");
    const drawn = renderToStaticMarkup(
      <AvatarButton
        displayName="Ryan"
        sprite="cat"
        color="#fff"
        memberId="m1"
      />,
    );
    expect(drawn).toContain("data-housemate");
  });
});

describe("AvatarGallery", () => {
  const options = [
    { id: "a1", name: "Knight", sprites: SET },
    { id: "a2", name: "Mage", sprites: SET },
  ];

  it("offers each character as a radio, the picked one marked", () => {
    const html = renderToStaticMarkup(
      <AvatarGallery
        legend="Gallery"
        name="avatarId"
        options={options}
        value="a2"
        onChange={() => {}}
        none={{ label: "Drawn", picture: <span>drawn</span> }}
      />,
    );
    expect(html).toContain('data-avatar="none"');
    expect(html).toContain('data-avatar="a1" data-picked="false"');
    expect(html).toContain('data-avatar="a2" data-picked="true"');
    expect(html.match(/Picked/g)).toHaveLength(1);
    expect(html).toContain('checked="" value="a2"');
  });

  it("leaves out the none tile when not asked for it", () => {
    const html = renderToStaticMarkup(
      <AvatarGallery
        legend="Gallery"
        name="avatarId"
        options={options}
        value=""
        onChange={() => {}}
      />,
    );
    expect(html).toContain('data-avatar="a1"');
    expect(html).not.toContain('data-avatar="none"');
    expect(html).not.toContain("Picked");
  });
});
