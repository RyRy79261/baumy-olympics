// A short name for the browser that asked to sign in ("Chrome on macOS"),
// for brain's DM (issue #80): enough for the member to recognise their own
// device, and nothing that identifies it further. Pure, so the tests can feed
// it real user-agent strings.

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPad/, "iPad"],
  [/iPhone|iPod/, "iPhone"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

const first = (ua: string, table: [RegExp, string][]) =>
  table.find(([pattern]) => pattern.test(ua))?.[1];

/** "Chrome on macOS", "Safari on iPad", or "a browser" when unknown. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").slice(0, 512);
  const browser = first(ua, BROWSERS);
  const system = first(ua, SYSTEMS);
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  if (system) return `a browser on ${system}`;
  return "a browser";
}
