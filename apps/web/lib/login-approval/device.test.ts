import { describe, expect, it } from "vitest";
import { deviceLabel } from "./device";

// The short device name brain's DM shows (issue #80), from real user agents.

const UA = {
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipadChrome:
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  linuxFirefox:
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
};

describe("deviceLabel", () => {
  it("names the browser and the system", () => {
    expect(deviceLabel(UA.macChrome)).toBe("Chrome on macOS");
    expect(deviceLabel(UA.macSafari)).toBe("Safari on macOS");
    expect(deviceLabel(UA.iphoneSafari)).toBe("Safari on iPhone");
    expect(deviceLabel(UA.ipadChrome)).toBe("Chrome on iPad");
    expect(deviceLabel(UA.androidChrome)).toBe("Chrome on Android");
    expect(deviceLabel(UA.windowsEdge)).toBe("Edge on Windows");
    expect(deviceLabel(UA.linuxFirefox)).toBe("Firefox on Linux");
  });

  it("says what it can, and nothing it cannot", () => {
    expect(deviceLabel("Firefox/130.0")).toBe("Firefox");
    expect(deviceLabel("SomethingOn Windows NT")).toBe("a browser on Windows");
    expect(deviceLabel("curl/8.0")).toBe("a browser");
    expect(deviceLabel(null)).toBe("a browser");
    expect(deviceLabel(undefined)).toBe("a browser");
  });
});
