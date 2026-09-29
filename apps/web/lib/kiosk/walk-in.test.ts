// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The walk-in cookie's name reaches a client component
// (components/kiosk/forget-cookie.tsx). Importing it from lib/kiosk/cookies.ts,
// which uses node:crypto, put a 136 KB crypto polyfill into the kiosk
// dashboard's browser bundle; walk-in.ts stays free of node imports.

const WEB = path.resolve(import.meta.dirname, "../..");
const read = (f: string) => readFileSync(path.join(WEB, f), "utf8");

describe("the walk-in cookie module", () => {
  it("has no node imports, and the client component uses it, not cookies.ts", () => {
    const client = read("components/kiosk/forget-cookie.tsx");
    expect(client).toContain('"use client"');
    expect(client).toContain('from "@/lib/kiosk/walk-in"');
    expect(client).not.toContain("@/lib/kiosk/cookies");
    expect(read("lib/kiosk/walk-in.ts")).not.toMatch(/from\s+["']node:/);
  });
});
