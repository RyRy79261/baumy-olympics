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
      <MemberCharacter image={SPRITE} scale={7} label="Ryan" bob />,
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
    const html = renderToStaticMarkup(<MemberCharacter image={SPRITE} />);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  it("falls back to the drawn Housemate without a sprite", () => {
    const html = renderToStaticMarkup(
      <MemberCharacter image={null} memberId="m1" scale={2} />,
    );
    expect(html).toContain("data-housemate");
    expect(html).not.toContain("data-member-sprite");
  });

  it("is what the kiosk's avatar button draws", () => {
    const withSprite = renderToStaticMarkup(
      <AvatarButton
        displayName="Ryan"
        sprite="cat"
        color="#fff"
        memberId="m1"
        image={SPRITE}
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
    { id: "a1", name: "Knight", image: SPRITE },
    { id: "a2", name: "Mage", image: SPRITE },
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
