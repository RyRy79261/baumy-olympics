import { describe, expect, it } from "vitest";
import { sessionLabel } from "./session-label";

describe("sessionLabel", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
      "Chrome on Windows",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on iPhone",
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1",
      "Chrome on iPad",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0",
      "Firefox on macOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 EdgA/129.0 Edg/129.0",
      "Edge on Android",
    ],
    ["curl/8.5.0", "Unknown device"],
    ["SomeBot (X11; Linux x86_64)", "Linux"],
    ["Opera/9.80", "Opera"],
  ])("names %s", (ua, label) => {
    expect(sessionLabel(ua)).toBe(label);
  });

  it("says Unknown device when there is no user agent", () => {
    expect(sessionLabel(null)).toBe("Unknown device");
    expect(sessionLabel(undefined)).toBe("Unknown device");
    expect(sessionLabel("")).toBe("Unknown device");
  });
});
