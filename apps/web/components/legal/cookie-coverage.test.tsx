// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildAuthOptions } from "@baumy/auth";
import { AUTH_COOKIE_PREFIX } from "@baumy/auth/env";
import PrivacyPage from "@/app/privacy/page";
import { REFRESH_COOKIE } from "@/lib/hub/refresh";
import { KIOSK_COOKIE, KIOSK_MEMBER_COOKIE } from "@/lib/kiosk/cookies";
import { LOGIN_COOKIE } from "@/lib/login-approval/flow";

// Issues #87 and #89: the privacy page must name every cookie the app sets.
//
// - Our own setters: this scans the source (the web app and packages/auth,
//   .ts/.tsx/.js/.mjs) for anything that sets a cookie, so a new one fails
//   here until it is added to KNOWN below AND to the page's cookie list.
// - Better Auth's: the library sets them, so no scan can see them. Its
//   session cookies are named on the page from AUTH_COOKIE_PREFIX, and the
//   plugin and social-provider lists are pinned below: a new plugin (which
//   may bring cookies of its own) fails here until the page is checked.

const WEB = path.resolve(import.meta.dirname, "../..");
const AUTH_SRC = path.resolve(WEB, "../../packages/auth/src");
const SCANNED = [
  ...["app", "lib", "components", "public"].map((d) => path.join(WEB, d)),
  AUTH_SRC,
];

/** What a setter's first argument names, for every setter in the code. */
const KNOWN: Record<string, string> = {
  KIOSK_COOKIE,
  KIOSK_MEMBER_COOKIE,
  "refreshCookieLine()": REFRESH_COOKIE,
  // Sign in with Baumy's routes (lib/login-approval/flow.ts): its own cookie
  // (loginCookie), and Better Auth's session cookies passed through.
  '"set-cookie"': LOGIN_COOKIE,
};

/** Better Auth plugins and social providers the page was written against. */
const AUTH_PLUGINS = ["bearer"];
const AUTH_SOCIAL = ["google"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "node_modules" || name === "__tests__"
        ? []
        : sourceFiles(full);
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(name) || /\.test\.tsx?$/.test(name)) {
      return [];
    }
    return [full];
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every `<file>: <first argument>` that sets a cookie in `source`. */
function cookieSetters(file: string, source: string): string[] {
  const found: string[] = [];
  // `cookies` under any name: `import { cookies as jarOf } from …`.
  const fns = [
    "cookies",
    ...[...source.matchAll(/\bcookies\s+as\s+(\w+)/g)].map((m) => m[1]!),
  ];
  const call = String.raw`(?:${fns.map(escape).join("|")})\(\)`;
  // A store held in a variable: `const jar = await cookies();`.
  const stores = [
    ...source.matchAll(
      new RegExp(String.raw`(\w+)\s*=\s*(?:await\s+)?${call}`, "g"),
    ),
  ].map((m) => m[1]!);
  const receivers = [
    String.raw`${call}\)?`,
    String.raw`\.cookies`,
    String.raw`\bcookieStore`,
    ...stores.map((s) => String.raw`\b${escape(s)}`),
  ];
  const setter = new RegExp(
    String.raw`(?:${receivers.join("|")})\s*\.set\(\s*([^,\s)]+(?:\(\))?)`,
    "g",
  );
  for (const m of source.matchAll(setter)) found.push(`${file}: ${m[1]}`);
  for (const m of source.matchAll(/document\.cookie\s*=(?!=)\s*([^;\n]+)/g)) {
    found.push(`${file}: ${m[1]!.trim()}`);
  }
  for (const m of source.matchAll(/["'`]set-cookie["'`]/gi)) {
    found.push(`${file}: ${m[0]}`);
  }
  return found;
}

const argOf = (s: string) => s.slice(s.indexOf(": ") + 2);

describe("the privacy page's cookie list", () => {
  const page = renderToStaticMarkup(<PrivacyPage />);
  const setters = SCANNED.flatMap((dir) =>
    sourceFiles(dir).flatMap((file) =>
      cookieSetters(
        path.relative(path.resolve(WEB, "../.."), file),
        readFileSync(file, "utf8"),
      ),
    ),
  );

  it("finds every setter it knows about", () => {
    const seen = new Set(setters.map(argOf));
    for (const known of Object.keys(KNOWN)) expect(seen).toContain(known);
  });

  it("knows what every cookie setter in the code sets", () => {
    expect(setters.filter((s) => !(argOf(s) in KNOWN))).toEqual([]);
  });

  it("names every cookie the code sets, and Better Auth's", () => {
    const names = [
      ...Object.values(KNOWN),
      `${AUTH_COOKIE_PREFIX}.session_token`,
      `${AUTH_COOKIE_PREFIX}.session_data`,
      `${AUTH_COOKIE_PREFIX}.dont_remember`,
    ];
    for (const name of names) expect(page).toContain(`<code>${name}</code>`);
  });

  it("was written against Better Auth's current plugins and providers", () => {
    const options = buildAuthOptions({
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    });
    expect(options.plugins.map((p) => p.id)).toEqual(AUTH_PLUGINS);
    expect(Object.keys(options.socialProviders ?? {})).toEqual(AUTH_SOCIAL);
  });

  it("catches setters in every shape it looks for", () => {
    const shapes: [string, string][] = [
      ['const store = await cookies();\nstore.set("a", "1");', '"a"'],
      ['(await cookies()).set(B, "1")', "B"],
      [
        'import { cookies as jarOf } from "next/headers";\n(await jarOf()).set(C, "1")',
        "C",
      ],
      [
        'const j = await jarOf();\nj.set(D, "1")\nimport { cookies as jarOf } from "x"',
        "D",
      ],
      ['res.cookies.set(E, "1")', "E"],
      ['cookieStore.set("f", "1")', '"f"'],
      ['document.cookie = "g=1"', '"g=1"'],
      ['headers.append("Set-Cookie", x)', '"Set-Cookie"'],
    ];
    for (const [source, arg] of shapes) {
      expect(cookieSetters("x.ts", source)).toEqual([`x.ts: ${arg}`]);
    }
    expect(
      cookieSetters("y.ts", 'if (document.cookie == "x") jar.get(A)'),
    ).toEqual([]);
  });
});
