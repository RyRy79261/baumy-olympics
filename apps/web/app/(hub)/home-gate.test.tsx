import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageMember } from "@/lib/auth";

// Issue #96: `/` is public. Nobody signed in gets the landing page from the
// hub's page, and the hub's frame steps aside for it; a member still gets
// the hub. The frame no longer sends a signed-out visitor to sign-in, so
// every other hub page must run its own gate.

const memberOrVisitorPage = vi.fn<() => Promise<PageMember | null>>();
vi.mock("@/lib/auth", () => ({
  memberOrVisitorPage: () => memberOrVisitorPage(),
  requireMemberPage: vi.fn(),
}));
const loadHub = vi.fn();
vi.mock("@/lib/hub/load", () => ({
  loadHub: (...a: unknown[]) => loadHub(...a),
}));
vi.mock("@/lib/actions/ui", () => ({ uiRequestCtx: async () => ({}) }));
vi.mock("@baumy/db", () => ({ createHttpDb: () => ({}) }));
vi.mock("@baumy/db/members", () => ({
  listActiveMembers: async () => [],
  findKioskPinLockedAt: async () => null,
}));
vi.mock("@/components/hub/hub-home", () => ({
  HubHome: () => <div data-testid="hub-home" />,
}));
vi.mock("@/components/hub/post-reminder-form", () => ({
  PostReminderForm: () => null,
}));
vi.mock("./reminder-actions", () => ({ createReminderAction: vi.fn() }));
vi.mock("./shopping/actions", () => ({
  addShoppingAction: vi.fn(),
  checkOffShoppingAction: vi.fn(),
}));
vi.mock("@/lib/integrations/groq", () => ({ voiceConfigured: () => false }));
vi.mock("@/lib/actions/registry", () => ({ runAction: vi.fn() }));
vi.mock("@/lib/background-work", () => ({ runSweepAfterResponse: vi.fn() }));
vi.mock("@/lib/members/characters", () => ({
  activeCharacters: async () => new Map(),
  rosterColours: () => ({}),
}));

const { default: HubPage, metadata } = await import("./page");
const { default: HubLayout } = await import("./layout");

const member = {
  kind: "member",
  userId: "u1",
  email: "a@b.c",
  name: "A",
  emailVerified: true,
  sessionCreatedAt: "2026-09-28T09:00:00.000Z",
  memberId: "m1",
  role: "member",
  displayName: "Ada",
} as PageMember;

beforeEach(() => {
  memberOrVisitorPage.mockReset();
  loadHub.mockReset();
});

describe("/", () => {
  it("shows nobody the landing page, and reads nothing from the hub", async () => {
    memberOrVisitorPage.mockResolvedValue(null);
    const out = renderToStaticMarkup(await HubPage());
    expect(out).toContain(">Baumy Olympics</h1>");
    expect(out).toContain("private household app");
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/terms"');
    expect(out).not.toContain("hub-home");
    expect(loadHub).not.toHaveBeenCalled();
  });

  it("still shows a member the hub", async () => {
    memberOrVisitorPage.mockResolvedValue(member);
    loadHub.mockResolvedValue({});
    const out = renderToStaticMarkup(await HubPage());
    expect(out).toContain('data-testid="hub-home"');
    expect(out).toContain("Welcome, Ada.");
    expect(out).not.toContain("private household app");
  });

  it("describes the app in its metadata", () => {
    expect(metadata.title).toBe("Baumy Olympics");
    expect(metadata.description).toContain("private household app");
  });

  it("lets the frame step aside for nobody", async () => {
    memberOrVisitorPage.mockResolvedValue(null);
    const out = renderToStaticMarkup(
      await HubLayout({ children: <p data-testid="child">x</p> }),
    );
    expect(out).toBe('<p data-testid="child">x</p>');
  });
});

describe("every other hub page", () => {
  const root = import.meta.dirname;
  function pages(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return pages(full);
      return name === "page.tsx" ? [full] : [];
    });
  }

  it("runs its own page gate", () => {
    const found = pages(root).filter((f) => f !== path.join(root, "page.tsx"));
    expect(found.length).toBeGreaterThan(5);
    for (const file of found) {
      expect(readFileSync(file, "utf8"), path.relative(root, file)).toMatch(
        /await require(Member|Admin)Page\(/,
      );
    }
  });
});
