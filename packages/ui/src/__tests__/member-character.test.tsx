import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarGallery } from "../avatar-gallery";
import { AvatarButton } from "../kiosk-shell";
import {
  BUST_FRACTION,
  BUST_MAX_PX,
  CHARACTER_SLOT_PX,
  MemberCharacter,
  initialOf,
  spriteFactor,
  spriteFit,
} from "../member-character";

// A member's gallery sprite (issue #111), drawn crisp at whole-number
// scales in its slot; without one, their initial tile (issue #116).

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
    expect(spriteFactor(56, CHARACTER_SLOT_PX * 3)).toBe(1); // 51 → 56
    expect(spriteFactor(56, CHARACTER_SLOT_PX * 2)).toBe(1 / 2); // 34 → 28
    expect(spriteFactor(56, CHARACTER_SLOT_PX * 7)).toBe(2); // 119 → 112
    expect(spriteFactor(56, CHARACTER_SLOT_PX)).toBe(1 / 3); // 17 → 19
    expect(spriteFactor(14, 400)).toBe(8); // capped
  });
});

describe("spriteFit (the bust in small slots)", () => {
  it("draws a 64px set whole where it is taller than 32px, else its top 45%", () => {
    // Dashboard (scale 4): whole, at 1×.
    expect(spriteFit(64, CHARACTER_SLOT_PX * 4)).toEqual({
      f: 1,
      rows: null,
    });
    // Kitchen bar (scale 2): whole would be 32px, so the bust (29 rows) at 1×.
    expect(spriteFit(64, CHARACTER_SLOT_PX * 2)).toEqual({ f: 1, rows: 29 });
    // Header (scale 1): the bust at 1/2 rather than the body at 1/4.
    expect(spriteFit(64, CHARACTER_SLOT_PX)).toEqual({ f: 1 / 2, rows: 29 });
    expect(Math.ceil(64 * BUST_FRACTION)).toBe(29);
    expect(64 / 2).toBeLessThanOrEqual(BUST_MAX_PX);
  });

  it("smooths below 1× so outlines are averaged, and stays pixelated at 1× and up", () => {
    const set = { idle: { src: "/i.png", width: 21, height: 64 } };
    const header = renderToStaticMarkup(
      <MemberCharacter sprites={set} scale={1} />,
    );
    expect(header).toContain("image-rendering:auto");
    const bar = renderToStaticMarkup(
      <MemberCharacter sprites={set} scale={2} />,
    );
    expect(bar).toContain("image-rendering:pixelated");
  });

  it("crops the drawn image to the bust, the whole image kept inside", () => {
    const set = { idle: { src: "/i.png", width: 21, height: 64 } };
    const html = renderToStaticMarkup(
      <MemberCharacter sprites={set} scale={2} />,
    );
    expect(html).toContain('data-bust="true"');
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("width:21px;height:29px");
    expect(html).toContain('height="64"');
    const whole = renderToStaticMarkup(
      <MemberCharacter sprites={set} scale={4} />,
    );
    expect(whole).toContain("data-member-sprite");
    expect(whole).not.toContain("data-bust");
  });
});

describe("initialOf", () => {
  it("is the name's first letter, upper-cased, or ? for no name", () => {
    expect(initialOf("ryan")).toBe("R");
    expect(initialOf("  Øyvind")).toBe("Ø");
    expect(initialOf("😀 Kim")).toBe("😀");
    expect(initialOf("   ")).toBe("?");
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
    expect(html).not.toContain("data-member-initial");
  });

  it("is decorative without a label", () => {
    const html = renderToStaticMarkup(<MemberCharacter sprites={SET} />);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows the initial tile in their colour without a sprite, never a drawn person", () => {
    const html = renderToStaticMarkup(
      <MemberCharacter
        sprites={null}
        name="jo"
        colour="#3b82c4"
        scale={2}
        label="Jo"
      />,
    );
    expect(html).toContain("data-member-initial");
    expect(html).toContain(">J</span>");
    expect(html).toContain("color:#3b82c4");
    expect(html).toContain("color-mix(in srgb, #3b82c4 22%, transparent)");
    // A square the height of the slot, as a sprite would fill.
    expect(html).toContain(`width:${CHARACTER_SLOT_PX * 2}px`);
    expect(html).toContain(`height:${CHARACTER_SLOT_PX * 2}px`);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Jo"');
    expect(html).not.toContain("data-member-sprite");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
  });

  it("sizes the initial tile at every scale it is used at", () => {
    for (const scale of [1, 2, 3, 4, 7]) {
      const html = renderToStaticMarkup(
        <MemberCharacter name="Sam" colour="#4caf50" scale={scale} />,
      );
      expect(html).toContain(`width:${CHARACTER_SLOT_PX * scale}px`);
      expect(html).toContain('aria-hidden="true"');
    }
    const bob = renderToStaticMarkup(<MemberCharacter name="Sam" bob />);
    expect(bob).toContain("motion-safe:animate-pixel-bob");
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
        color="#fff"
        character={<i data-testid="custom" />}
      />,
    );
    expect(html).toContain('data-testid="custom"');
    expect(html).not.toContain("data-member-initial");
  });

  it("is what the kiosk's avatar button draws", () => {
    const withSprite = renderToStaticMarkup(
      <AvatarButton displayName="Ryan" color="#fff" sprites={SET} />,
    );
    expect(withSprite).toContain("data-member-sprite");
    const none = renderToStaticMarkup(
      <AvatarButton displayName="Ryan" color="#fff" />,
    );
    expect(none).toContain("data-member-initial");
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
        none={{ label: "None", picture: <span>none</span> }}
      />,
    );
    expect(html).toContain('data-avatar="none"');
    expect(html).toContain('data-avatar="a1" data-picked="false"');
    expect(html).toContain('data-avatar="a2" data-picked="true"');
    expect(html.match(/Picked/g)).toHaveLength(1);
    expect(html).toContain('checked="" value="a2"');
  });

  it("shows each character's whole name, wrapping, never cut off", () => {
    const long = "Harper the pirate queen";
    const html = renderToStaticMarkup(
      <AvatarGallery
        legend="Gallery"
        name="avatarId"
        options={[{ id: "a1", name: long, sprites: SET }]}
        value=""
        onChange={() => {}}
      />,
    );
    expect(html).toMatch(
      /<span data-name="true" class="[^"]*break-words[^"]*">Harper the pirate queen</,
    );
    expect(html).not.toContain("truncate");
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
