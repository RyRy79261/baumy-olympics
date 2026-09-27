import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LevelMeter, MicButton } from "../voice";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("MicButton", () => {
  it("says what a hold does in each state", () => {
    const idle = html(<MicButton state="idle" />);
    expect(idle).toContain("Hold to speak");
    expect(idle).toContain('aria-pressed="false"');
    expect(idle).toContain('type="button"');
    expect(idle).toContain("touch-none");
    expect(idle).toContain("select-none");
    expect(idle).toContain("min-h-11");
    expect(idle).not.toContain('disabled=""');

    const rec = html(<MicButton state="recording" kiosk />);
    expect(rec).toContain("Release to send");
    expect(rec).toContain('aria-pressed="true"');
    expect(rec).toContain('data-state="recording"');
    expect(rec).toContain("min-h-14");

    expect(html(<MicButton state="recording" label="Tap to send" />)).toContain(
      "Tap to send",
    );
  });

  it("cannot be pressed while the microphone opens or the clip is sent", () => {
    for (const state of ["starting", "sending"] as const) {
      expect(html(<MicButton state={state} />)).toContain('disabled=""');
    }
    expect(html(<MicButton state="idle" disabled />)).toContain('disabled=""');
  });
});

describe("LevelMeter", () => {
  it("is a meter from 0 to 100, clamped", () => {
    const out = html(<LevelMeter level={0.42} />);
    expect(out).toContain('role="meter"');
    expect(out).toContain('aria-label="Microphone level"');
    expect(out).toContain('aria-valuenow="42"');
    expect(out).toContain("width:42%");
    expect(html(<LevelMeter level={3} />)).toContain('aria-valuenow="100"');
    expect(html(<LevelMeter level={-1} />)).toContain('aria-valuenow="0"');
  });
});
