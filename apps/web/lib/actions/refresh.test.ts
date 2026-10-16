// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SURFACES } from "@baumy/types";
import type { ActionName, AnyActionDef } from "./define";
import {
  REFRESH_TAGS,
  TAG_PATHS,
  refreshKey,
  refreshPaths,
  type RefreshPath,
  type RefreshSide,
} from "./refresh";
import { REGISTRY } from "./registry";
import { toolSpecs } from "./tool-specs";

// Each write says what data it changes, and one map turns that into the hub
// and kiosk pages to refresh (issue #215, SPEC §6.3).

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
const { refreshAfter } = await import("./revalidate");

beforeEach(() => revalidatePath.mockReset());

const entries = Object.entries(REGISTRY) as [ActionName, AnyActionDef][];
const SIDES: RefreshSide[] = ["hub", "kiosk"];

/**
 * What each server action wrapper revalidated by hand before issue #215,
 * copied once from app/(hub)/**\/actions.ts and app/kiosk/actions.ts. A
 * write must still refresh at least these pages; it may refresh more.
 * "(layout)" is `revalidatePath(path, "layout")`.
 */
const BEFORE: Record<RefreshSide, Partial<Record<ActionName, string[]>>> = {
  hub: {
    revoke_mcp_connection: ["/settings/connections"],
    revoke_session: ["/settings/security"],
    revoke_other_sessions: ["/settings/security"],
    rename_passkey: ["/settings/security"],
    remove_passkey: ["/settings/security"],
    unlink_google: ["/settings/security"],
    set_first_password: ["/settings/security"],
    dispute_completion: ["/activity", "/chores"],
    undo_completion: ["/activity", "/chores"],
    withdraw_dispute: ["/activity", "/chores"],
    concede_completion: ["/activity", "/chores"],
    resolve_dispute: ["/activity", "/chores"],
    archive_avatar: ["/admin/avatars"],
    restore_avatar: ["/admin/avatars"],
    set_kiosk_pin: ["/settings"],
    choose_avatar: ["/ (layout)"],
    schedule_weight: [
      "/admin/weights",
      "/activity",
      "/chores",
      "/chores/history",
    ],
    schedule_points_change: [
      "/admin/weights",
      "/activity",
      "/chores",
      "/chores/history",
    ],
    dismiss_weight: [
      "/admin/weights",
      "/activity",
      "/chores",
      "/chores/history",
    ],
    veto_weight: ["/admin/weights", "/activity", "/chores", "/chores/history"],
    create_service_token: ["/admin/connections"],
    rotate_service_token: ["/admin/connections"],
    revoke_service_token: ["/admin/connections"],
    create_note: ["/notes", "/"],
    update_note: ["/notes", "/"],
    pin_note: ["/notes", "/"],
    delete_note: ["/notes", "/"],
    acknowledge_note: ["/"],
    log_completion: ["/chores", "/admin/chores"],
    manage_chore: ["/admin/chores", "/chores"],
    update_bounties: ["/admin/chores", "/chores"],
    add_shopping_items: ["/shopping", "/"],
    set_shopping_category: ["/shopping", "/"],
    check_off_shopping_items: ["/shopping", "/"],
    create_event: ["/calendar"],
    update_event: ["/calendar"],
    delete_event: ["/calendar"],
    mint_invite: ["/admin/members"],
    revoke_invite: ["/admin/members"],
    manage_members: ["/admin/members"],
    adjust_points: ["/scores", "/pot"],
    set_prize_mode: ["/scores", "/pot"],
    rename_kiosk: ["/admin/kitchen-screen"],
    revoke_kiosk: ["/admin/kitchen-screen"],
    add_pot_contribution: ["/pot"],
  },
  kiosk: {
    log_completion: ["/kiosk/chores", "/kiosk/activity", "/kiosk"],
    dispute_completion: ["/kiosk/chores", "/kiosk/activity", "/kiosk"],
    undo_completion: ["/kiosk/chores", "/kiosk/activity", "/kiosk"],
    withdraw_dispute: ["/kiosk/chores", "/kiosk/activity", "/kiosk"],
    concede_completion: ["/kiosk/chores", "/kiosk/activity", "/kiosk"],
    create_event: ["/kiosk/calendar"],
    update_event: ["/kiosk/calendar"],
    delete_event: ["/kiosk/calendar"],
    create_note: ["/kiosk/notes", "/kiosk"],
    update_note: ["/kiosk/notes", "/kiosk"],
    pin_note: ["/kiosk/notes", "/kiosk"],
    delete_note: ["/kiosk/notes", "/kiosk"],
    add_shopping_items: ["/kiosk/shopping", "/kiosk"],
    check_off_shopping_items: ["/kiosk/shopping", "/kiosk"],
    set_shopping_category: ["/kiosk/shopping", "/kiosk"],
    set_kiosk_idle_minutes: ["/kiosk (layout)"],
    schedule_points_change: ["/kiosk/settings"],
    update_bounties: [
      "/kiosk/settings",
      "/kiosk/chores",
      "/kiosk/activity",
      "/kiosk",
    ],
  },
};

/** The page file a path renders, on its side. */
function pageFile(side: RefreshSide, p: RefreshPath): string {
  const app = join(__dirname, "..", "..", "app");
  if (side === "hub") return join(app, "(hub)", p.path, "page.tsx");
  const rest = p.path.replace(/^\/kiosk/, "");
  return join(app, "kiosk", "(shell)", rest, "page.tsx");
}

describe("refreshes", () => {
  it("every write declares what it changes, and no read does", () => {
    const writes = entries.filter(([, d]) => d.kind === "write");
    expect(writes.length).toBeGreaterThan(0);
    for (const [name, def] of entries) {
      if (def.kind === "write") {
        expect(def.refreshes, name).toBeInstanceOf(Array);
        for (const tag of def.refreshes!) {
          expect(REFRESH_TAGS, name).toContain(tag);
        }
      } else {
        expect(def.refreshes, name).toBeUndefined();
      }
    }
  });

  it("every tag reaches at least one page, and every page exists", () => {
    for (const tag of REFRESH_TAGS) {
      const all = [...TAG_PATHS[tag].hub, ...TAG_PATHS[tag].kiosk];
      expect(all.length, tag).toBeGreaterThan(0);
      for (const side of SIDES) {
        for (const p of TAG_PATHS[tag][side]) {
          expect(existsSync(pageFile(side, p)), `${tag}: ${p.path}`).toBe(true);
          if (side === "kiosk") expect(p.path).toMatch(/^\/kiosk(\/|$)/);
          else expect(p.path).not.toMatch(/^\/kiosk(\/|$)/);
        }
      }
    }
  });

  it("every write still refreshes each page its wrapper refreshed before (issue #215)", () => {
    let checked = 0;
    for (const side of SIDES) {
      for (const [name, before] of Object.entries(BEFORE[side])) {
        const tags = REGISTRY[name as ActionName].refreshes ?? [];
        const now = refreshPaths(tags, side).map(refreshKey);
        for (const path of before!) {
          expect(now, `${side} ${name}`).toContain(path);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  it("never reaches a tool spec", () => {
    for (const surface of SURFACES) {
      const specs = toolSpecs(surface);
      for (const spec of specs) expect(spec).not.toHaveProperty("refreshes");
      expect(JSON.stringify(specs)).not.toContain("refreshes");
    }
  });
});

describe("refreshPaths", () => {
  it("lists each path once, in map order", () => {
    expect(refreshPaths(["notes", "shopping"], "hub")).toEqual([
      { path: "/notes" },
      { path: "/" },
      { path: "/shopping" },
    ]);
    expect(refreshPaths([], "kiosk")).toEqual([]);
  });

  it("keeps a page and the layout of the same path apart", () => {
    const keys = refreshPaths(["notes", "reminders"], "kiosk").map(refreshKey);
    expect(keys).toEqual(["/kiosk/notes", "/kiosk", "/kiosk (layout)"]);
  });
});

describe("refreshAfter", () => {
  it("revalidates every page of the action's tags on that side", () => {
    refreshAfter("log_completion", "kiosk");
    expect(revalidatePath.mock.calls).toEqual(
      refreshPaths(["chores", "activity", "scores"], "kiosk").map((p) => [
        p.path,
      ]),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/kiosk/chores");
  });

  it("revalidates a layout as a layout", () => {
    refreshAfter("set_kiosk_idle_minutes", "kiosk");
    expect(revalidatePath.mock.calls).toEqual([["/kiosk", "layout"]]);
  });

  it("revalidates nothing for a read, or a write no page shows", () => {
    refreshAfter("whoami", "hub");
    refreshAfter("report_bug", "kiosk");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
