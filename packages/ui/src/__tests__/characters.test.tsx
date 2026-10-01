import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BAUMY_STATE_FRAMES, BaumyCat, baumyFrames } from "../baumy-cat";
import { BAUMY_STATES, SPRITE_MOTION, STATE_MARK } from "../baumy-states";
import { choreGlyph, ChoreTile } from "../chores";
import { AvatarButton } from "../kiosk-shell";
import {
  BAUMY_COLOURS,
  BAUMY_FRAMES,
  BAUMY_H,
  BAUMY_W,
} from "../pixel/baumy-cat";
import { CAT_FRAMES, CAT_H, CAT_W } from "../pixel/inkblot-cat";
import { gridSize } from "../pixel/pixel-grid";
import { scale2x } from "../pixel/scale2x";
import { RACCOON_FRAMES, RACCOON_PALETTE, Raccoon } from "../raccoon";
import { ToastItem, ToastList } from "../toast";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("Baumy's art", () => {
  it("is Camp 404's cat through Scale2x, frame for frame", () => {
    expect(BAUMY_W).toBe(CAT_W * 2);
    expect(BAUMY_H).toBe(CAT_H * 2);
    for (const [name, frames] of Object.entries(CAT_FRAMES)) {
      const big = BAUMY_FRAMES[name as keyof typeof CAT_FRAMES];
      expect(big).toHaveLength(frames.length);
      frames.forEach((f, i) => {
        expect(big[i]).toEqual(scale2x(f));
        expect(gridSize(big[i]!)).toEqual({ w: BAUMY_W, h: BAUMY_H });
      });
    }
  });

  it("matches the approved sitting frame, pixel for pixel", () => {
    // Worked out apart from this code (EPX by hand over inkblot-cat.ts), so
    // a change to the art or to Scale2x shows up here.
    const counts: Record<string, number> = {};
    for (const row of BAUMY_FRAMES.idle[0]!)
      for (const ch of row) counts[ch] = (counts[ch] ?? 0) + 1;
    expect(counts).toEqual({ ".": 712, O: 189, D: 92, K: 91, E: 4 });
    // The eye row: one art pixel of eye became a 2 × 2 block.
    expect(BAUMY_FRAMES.idle[0]!.slice(14, 16)).toEqual([
      "................OODDEEDDDDOOOO....",
      "................OODDEEDDDDOOOO....",
    ]);
  });

  it("wears the reference photo's colours, with the green eye", () => {
    expect(BAUMY_COLOURS).toEqual({
      K: "#1f1830",
      D: "#4a3a6a",
      O: "#0a0710",
      E: "#43f0a0",
    });
    // Every pixel of every frame is one of those, or clear.
    for (const frames of Object.values(BAUMY_FRAMES))
      for (const frame of frames)
        for (const row of frame) expect(row).toMatch(/^[KDOE.]+$/);
  });
});

describe("BaumyCat", () => {
  it("plays the cat's own frames for every state", () => {
    for (const state of BAUMY_STATES) {
      const frames = baumyFrames(state);
      expect(frames.length).toBe(BAUMY_STATE_FRAMES[state].frames.length);
      for (const f of frames)
        expect(Object.values(BAUMY_FRAMES).flat()).toContainEqual(f);
    }
    expect(baumyFrames("idle")).toEqual(BAUMY_FRAMES.idle);
    expect(baumyFrames("happy")).toEqual([
      BAUMY_FRAMES.jumpUp[0],
      BAUMY_FRAMES.jumpDown[0],
    ]);
    expect(baumyFrames("sleeping")).toEqual([BAUMY_FRAMES.idle[0]]);
  });

  it("says its state in data and a mark, and moves only motion-safe", () => {
    for (const state of BAUMY_STATES) {
      const out = html(<BaumyCat state={state} />);
      expect(out).toContain('data-sprite="baumy"');
      expect(out).toContain(`data-state="${state}"`);
      expect(out).toContain(
        `data-frames="${BAUMY_STATE_FRAMES[state].frames.length}"`,
      );
      const mark = STATE_MARK[state];
      if (mark) {
        expect(out).toContain('data-mark="true"');
        expect(out).toContain(`>${mark}</span>`);
      } else expect(out).not.toContain("data-mark");
      // A scene that draws its own mark turns the cat's off.
      expect(html(<BaumyCat state={state} showMark={false} />)).not.toContain(
        "data-mark",
      );
      const motion = SPRITE_MOTION[state];
      if (motion) expect(out).toContain(motion);
      expect(out.replace(/motion-safe:animate-[\w-]+/g, "")).not.toMatch(
        /animate-/,
      );
    }
  });

  it("sleeps still: one frame, no strip, no bob", () => {
    const out = html(<BaumyCat state="sleeping" />);
    expect(out).toContain('data-frames="1"');
    expect(out).toContain('data-motion="still"');
    expect(out).not.toContain("animate-");
  });

  it("is 34 × 32 art pixels at its scale, facing left unless told", () => {
    const out = html(<BaumyCat scale={4} />);
    expect(out).toContain(`width:${BAUMY_W * 4}px;height:${BAUMY_H * 4}px`);
    expect(out).toContain("scaleX(-1)");
    expect(html(<BaumyCat facing="right" />)).not.toContain("scaleX(-1)");
    // The coat, the sheen, the outline and the eye are all drawn.
    for (const c of Object.values(BAUMY_COLOURS)) expect(out).toContain(c);
  });

  it("is decorative unless labelled", () => {
    expect(html(<BaumyCat />)).toContain('aria-hidden="true"');
    const out = html(<BaumyCat label="Baumy" />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Baumy"');
  });

  it("talks in a bubble above it, its tail on Baumy's side", () => {
    expect(html(<BaumyCat />)).not.toContain("data-bubble");
    const left = html(<BaumyCat speech="Mrrp?" />);
    expect(left).toContain("data-bubble");
    expect(left).toContain("Mrrp?");
    expect(left).toContain("right-[70px]");
    expect(left).toMatch(/w-\[min\(440px,80vw\)\] right-0/);
    const right = html(<BaumyCat speech="Hi" facing="right" />);
    expect(right).toContain("left-[70px]");
    expect(right).toMatch(/w-\[min\(440px,80vw\)\] left-0/);
  });
});

describe("Raccoon", () => {
  it("walks on two frames of one size that differ only in the legs", () => {
    expect(RACCOON_FRAMES).toHaveLength(2);
    const [a, b] = RACCOON_FRAMES;
    expect(gridSize(a!)).toEqual({ w: 18, h: 10 });
    expect(gridSize(b!)).toEqual(gridSize(a!));
    expect(a!.slice(0, 8)).toEqual(b!.slice(0, 8));
    expect(a!.slice(8)).not.toEqual(b!.slice(8));
    for (const f of RACCOON_FRAMES)
      for (const row of f)
        for (const ch of row)
          if (ch !== ".") expect(RACCOON_PALETTE[ch]).toBeTruthy();
  });

  it("trots in place, facing left when flipped", () => {
    const out = html(<Raccoon scale={6} />);
    expect(out).toContain('data-frames="2"');
    expect(out).toContain("--sprite-duration:320ms");
    expect(out).toContain("width:108px;height:60px");
    expect(html(<Raccoon flip />)).toContain("scaleX(-1)");
  });
});

describe("choreGlyph", () => {
  it("uses the glyph of that name, the nearest one, or the wrench", () => {
    expect(choreGlyph("fridge")).toBe("fridge");
    expect(choreGlyph("trash")).toBe("bin");
    expect(choreGlyph("bathroom")).toBe("tp");
    expect(choreGlyph("keller")).toBe("wrench");
  });

  it("shows the glyph in the chore tile", () => {
    const out = html(
      <ChoreTile
        name="Bins"
        sprite="trash"
        points={20}
        streak="No streak yet"
        status="Due"
        state="due"
      />,
    );
    expect(out).toContain('data-sprite="trash"');
    expect(out).toContain('data-glyph="bin"');
    expect(out).toContain("20 pts");
    // The text column takes no width of its own, so long names and streak
    // lines truncate instead of widening the page on a phone.
    expect(out).toMatch(/data-tile-text="true" class="[^"]*\bw-0\b/);
  });
});

describe("AvatarButton", () => {
  it("shows the member's initial tile in their colour without a gallery character", () => {
    const out = html(<AvatarButton displayName="ryan" color="#e8743b" />);
    expect(out).toContain("data-member-initial");
    expect(out).toContain(">R</span>");
    // Ink on their colour (initialTileColours).
    expect(out).toContain("background-color:#e8743b");
    expect(out).toMatch(/[^-]color:#0b0712/);
    expect(out).not.toContain("data-member-sprite");
    expect(out).toContain(">ryan<");
    // Not picked: no frame in their colour.
    expect(out).toContain('aria-pressed="false"');
    expect(out).not.toContain("--pf:#e8743b");
  });

  it("shows their gallery character, framed in their colour when picked", () => {
    const sprites = {
      idle: {
        src: "/api/blob?pathname=avatars%2Fa%2Fb.png",
        width: 28,
        height: 56,
      },
    };
    const out = html(
      <AvatarButton
        displayName="Jo"
        color="#d0467a"
        sprites={sprites}
        selected
      />,
    );
    expect(out).toContain("data-member-sprite");
    expect(out).not.toContain("data-member-initial");
    expect(out).toContain("--pf:#d0467a");
    expect(out).toContain('aria-pressed="true"');
  });
});

describe("Toasts", () => {
  it("frames each toast by its variant, errors as alerts", () => {
    const out = html(
      <ToastList aria-label="Notifications">
        <ToastItem variant="error">Nope</ToastItem>
        <ToastItem variant="success" onDismiss={() => undefined}>
          Saved
        </ToastItem>
        <ToastItem variant="info">FYI</ToastItem>
      </ToastList>,
    );
    expect(out).toMatch(/role="alert" data-variant="error"[^>]*--color-bm-red/);
    expect(out).toMatch(
      /role="status" data-variant="success"[^>]*--color-bm-green/,
    );
    expect(out).toMatch(
      /role="status" data-variant="info"[^>]*--color-bm-text/,
    );
    expect(out).toContain("Dismiss");
  });
});
