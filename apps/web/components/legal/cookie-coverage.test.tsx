// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_PREFIX } from "@baumy/auth/env";
import PrivacyPage from "@/app/privacy/page";
import { REFRESH_COOKIE } from "@/lib/hub/refresh";
import { KIOSK_COOKIE, KIOSK_MEMBER_COOKIE } from "@/lib/kiosk/cookies";

// Issue #87: the privacy page must name every cookie the app sets. This scans
// the app's source for cookie setters, so a new one fails here until it is
// added to KNOWN below AND to the page's cookie list.

const WEB = path.resolve(import.meta.dirname, "../..");
const SCANNED = ["app", "lib", "components"];

/** What a setter's first argument names, for every setter in the code. */
const KNOWN: Record<string, string> = {
  KIOSK_COOKIE,
  KIOSK_MEMBER_COOKIE,
  "refreshCookieLine()": REFRESH_COOKIE,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [full];
  });
}

/** Every `<file>: <first argument>` that sets a cookie in `source`. */
function cookieSetters(file: string, source: string): string[] {
  const found: string[] = [];
  // A cookie store held in a variable: `const jar = await cookies();`.
  const stores = [
    ...source.matchAll(/(\w+)\s*=\s*(?:await\s+)?cookies\(\)/g),
  ].map((m) => m[1]!);
  const receivers = [
    String.raw`cookies\(\)\)`,
    String.raw`\.cookies`,
    ...stores.map((s) => String.raw`\b${s}`),
  ];
  const setter = new RegExp(
    String.raw`(?:${receivers.join("|")})\s*\.set\(\s*([^,\s)]+(?:\(\))?)`,
    "g",
  );
  for (const m of source.matchAll(setter)) found.push(`${file}: ${m[1]}`);
  for (const m of source.matchAll(/document\.cookie\s*=\s*([^;\n]+)/g)) {
    found.push(`${file}: ${m[1]!.trim()}`);
  }
  for (const m of source.matchAll(/["'`]set-cookie["'`]/gi)) {
    found.push(`${file}: ${m[0]}`);
  }
  return found;
}

describe("the privacy page's cookie list", () => {
  const page = renderToStaticMarkup(<PrivacyPage />);
  const setters = SCANNED.flatMap((dir) =>
    sourceFiles(path.join(WEB, dir)).flatMap((file) =>
      cookieSetters(path.relative(WEB, file), readFileSync(file, "utf8")),
    ),
  );

  it("finds the setters it knows about", () => {
    expect(setters.length).toBeGreaterThanOrEqual(Object.keys(KNOWN).length);
  });

  it("knows what every cookie setter in the code sets", () => {
    const unknown = setters.filter(
      (s) => !(s.slice(s.indexOf(": ") + 2) in KNOWN),
    );
    expect(unknown).toEqual([]);
  });

  it("names every cookie the code sets, and Better Auth's", () => {
    const names = [
      ...Object.values(KNOWN),
      `${AUTH_COOKIE_PREFIX}.session_token`,
      `${AUTH_COOKIE_PREFIX}.session_data`,
    ];
    for (const name of names) expect(page).toContain(`<code>${name}</code>`);
  });

  it("catches a setter it has not seen", () => {
    const found = cookieSetters(
      "x.ts",
      'const store = await cookies();\nstore.set("baumy_new", "1");',
    );
    expect(found).toEqual(['x.ts: "baumy_new"']);
    expect(cookieSetters("y.ts", 'res.cookies.set(OTHER, "1")')).toEqual([
      "y.ts: OTHER",
    ]);
  });
});
