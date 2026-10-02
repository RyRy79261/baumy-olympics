import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CatBubble,
  CatButton,
  CatLink,
  CatSays,
  CatText,
  HoldToTalk,
  LevelBars,
} from "../cat-bubble";

// The kitchen cat's speech bubble (ADR 0005 §1; the approved prototype's
// cat-listen.png and cat-heard.png).

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("CatBubble", () => {
  it("grows leftwards over the cat, a polite live region naming its mode", () => {
    const out = html(
      <CatBubble mode="listening">
        <CatSays>Mrrp? I&apos;m listening…</CatSays>
      </CatBubble>,
    );
    expect(out).toContain('data-testid="cat-bubble"');
    expect(out).toContain('data-mode="listening"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("right-0 bottom-[calc(100%+10px)]");
    expect(out).toContain("w-[440px]");
    expect(out).toContain("data-bubble");
    expect(out).toContain("text-[16px]");
    expect(html(<CatSays size="sm">Got it!</CatSays>)).toContain("text-[14px]");
  });

  it("is the kit's dark panel in a violet pixel frame, not a white box (issue #155)", () => {
    const out = html(<CatBubble mode="talk">Hi</CatBubble>);
    expect(out).toContain("pixel-frame pixel-frame-4");
    expect(out).toContain("bg-bm-surface");
    expect(out).toContain("text-bm-text");
    expect(out).toContain("[--pf:var(--color-bm-violet)]");
    expect(out).not.toContain("bg-bm-bubble");
    expect(out).not.toContain("bg-white");
  });

  it("has a 56px close button only when it can be closed", () => {
    const out = html(
      <CatBubble mode="talk" onClose={() => undefined}>
        Hi
      </CatBubble>,
    );
    expect(out).toContain('aria-label="Close"');
    expect(out).toContain("size-14");
    expect(out).toContain('type="button"');
    expect(out).toContain("×");
    expect(html(<CatBubble mode="says">Hi</CatBubble>)).not.toContain(
      'aria-label="Close"',
    );
  });

  it("sets the hint muted and an error in red", () => {
    expect(html(<CatText tone="muted">Say it</CatText>)).toContain(
      "text-bm-muted",
    );
    expect(html(<CatText tone="error">No</CatText>)).toContain("text-bm-red");
    expect(html(<CatText>Hi</CatText>)).not.toMatch(/text-bm-(muted|red)/);
  });
});

describe("LevelBars", () => {
  it("raises five bars with the level, and keeps a low row in silence", () => {
    const quiet = html(<LevelBars level={0} />);
    expect(quiet.match(/height:30%/g)).toHaveLength(5);
    expect(quiet).toContain('data-level="0"');
    const loud = html(<LevelBars level={2} />);
    expect(loud).toContain('data-level="100"');
    expect(loud).toContain("height:100%");
    expect(html(<LevelBars level={-1} />)).toContain('data-level="0"');
  });
});

describe("CatButton and CatLink", () => {
  it("are 56px stepped kit buttons in three looks", () => {
    expect(html(<CatButton>Done talking</CatButton>)).toContain("bg-bm-violet");
    expect(html(<CatButton variant="go">Yes, do it</CatButton>)).toContain(
      "bg-bm-green",
    );
    const no = html(<CatButton variant="soft">No</CatButton>);
    expect(no).toContain("bg-bm-raised");
    expect(no).toContain("pixel-frame");
    expect(no).toContain("h-14");
    expect(no).toContain('type="button"');
    const link = html(<CatLink>Type instead</CatLink>);
    expect(link).toContain("min-h-14");
    expect(link).toContain("underline");
  });
});

describe("HoldToTalk", () => {
  it("is a big hold target with no callout, selection or scrolling", () => {
    const idle = html(<HoldToTalk state="idle" level={0} />);
    expect(idle).toContain("Hold to talk");
    expect(idle).toContain('aria-pressed="false"');
    expect(idle).toContain('data-state="idle"');
    expect(idle).toContain("h-24");
    expect(idle).toContain("bg-bm-violet");
    expect(idle).toContain("touch-none");
    expect(idle).toContain("select-none");
    expect(idle).toContain("[-webkit-touch-callout:none]");
    expect(idle).toContain('type="button"');
    expect(idle).not.toContain("data-level");
  });

  it("says it is opening the microphone", () => {
    const opening = html(<HoldToTalk state="opening" level={0} />);
    expect(opening).toContain("Opening the microphone…");
    expect(opening).toContain('aria-busy="true"');
  });

  it("turns red, pulses and shows the level while held", () => {
    const held = html(<HoldToTalk state="recording" level={0.5} />);
    expect(held).toContain("Release to send");
    expect(held).toContain('aria-pressed="true"');
    expect(held).toContain("bg-[#b8243a]");
    expect(held).toContain("motion-safe:animate-pulse");
    expect(held).toContain('data-level="50"');
    // The bars stand out white on the red, not pink on red.
    expect(held).toContain("bg-white");
    expect(held).not.toContain("bg-[#ff5a7a]");
    expect(html(<LevelBars level={0.5} />)).toContain("bg-[#ff5a7a]");
  });
});
