import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChoreView } from "@/lib/actions/list-chores";

// /chores for an admin and for a member (issue #109): the admin gets New
// bounty and an Edit button per bounty, and the page reads the waiting
// weight suggestions for Change points; a member gets neither, and the
// suggestions are not read.

const me = vi.hoisted(() => ({
  current: { memberId: "m-1", role: "admin", displayName: "Ryan" },
}));
const listActiveSuggestions = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth", () => ({
  requireMemberPage: async () => me.current,
}));
vi.mock("@/lib/actions/ui", () => ({ uiRequestCtx: async () => ({}) }));
vi.mock("@/lib/actions/registry", () => ({
  runAction: async () => ({ ok: true, data: { chores: [chore] } }),
}));
vi.mock("@baumy/db", () => ({ createHttpDb: () => ({}) }));
vi.mock("@baumy/db/members", () => ({
  listActiveMembers: async () => [{ id: "m-1", displayName: "Ryan" }],
}));
vi.mock("@baumy/db/weights", () => ({ listActiveSuggestions }));
vi.mock("@/app/(hub)/chores/actions", () => ({
  logCompletionAction: vi.fn(),
}));
vi.mock("@/app/(hub)/admin/chores/actions", () => ({
  manageChoreAction: vi.fn(),
}));
vi.mock("@/app/(hub)/admin/weights/actions", () => ({
  scheduleWeightAction: vi.fn(),
  dismissWeightAction: vi.fn(),
  vetoWeightAction: vi.fn(),
}));

const chore: ChoreView = {
  id: "c-1",
  name: "Trash",
  sprite: "trash",
  kind: "maintenance",
  proofMode: "none",
  confirmMode: "optimistic",
  effortFactorPct: 100,
  archived: false,
  basePoints: 15,
  cooldownMinutes: 24 * 60,
  intervalMinutes: 3 * 24 * 60,
  streak: null,
  lastDoneAt: null,
  state: "due",
  availableAt: null,
  dueAt: null,
  urgent: false,
  isNew: false,
  createdAt: "2026-09-01T10:00:00.000Z",
  next: null,
};

const { default: ChoresPage } = await import("./page");

beforeEach(() => {
  listActiveSuggestions.mockReset();
  listActiveSuggestions.mockResolvedValue([]);
});

async function render() {
  return renderToStaticMarkup(await ChoresPage());
}

describe("/chores", () => {
  it("gives an admin New bounty and an Edit button per bounty", async () => {
    me.current = { memberId: "m-1", role: "admin", displayName: "Ryan" };
    const html = await render();
    expect(html).toContain('data-testid="chore-Trash"');
    expect(html).toContain(">New bounty</button>");
    expect(html).toContain('aria-label="Edit Trash"');
    expect(listActiveSuggestions).toHaveBeenCalledOnce();
  });

  it("gives a member the board with neither", async () => {
    me.current = { memberId: "m-1", role: "member", displayName: "Ryan" };
    const html = await render();
    expect(html).toContain('data-testid="chore-Trash"');
    expect(html).not.toContain("New bounty");
    expect(html).not.toContain("Edit Trash");
    expect(listActiveSuggestions).not.toHaveBeenCalled();
  });
});
