// Chore steps shared by the chore specs, through the real pages.

import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { serverClock } from "./clock";
import { callTool, connect } from "./mcp";

export interface NewChore {
  name: string;
  basePoints: number;
  cooldownHours: number;
  /** Maintenance unless given (ADR 0005 §2). */
  kind?: "consumable" | "maintenance";
}

/** An admin adds a chore on /admin/chores. */
export async function addChore(admin: Page, chore: NewChore) {
  await admin.goto("/admin/chores");
  await expect(
    admin.getByRole("heading", { name: "Edit chores", level: 1 }),
  ).toBeVisible();
  const form = admin.locator("form").filter({
    has: admin.getByRole("button", { name: "Add chore" }),
  });
  await form.getByLabel("Name").fill(chore.name);
  if (chore.kind) await form.getByLabel("Kind").selectOption(chore.kind);
  await form.getByLabel("Base points").fill(String(chore.basePoints));
  await form.getByLabel("Cooldown (hours)").fill(String(chore.cooldownHours));
  await form.getByRole("button", { name: "Add chore" }).click();
  await expect(admin.getByTestId(`admin-chore-${chore.name}`)).toContainText(
    `${chore.basePoints} pts`,
  );
}

/** The tile of a chore in the grid. */
export function tile(page: Page, name: string): Locator {
  // The first: an admin also has the Edit button beside it (issue #109).
  return page.getByTestId(`chore-${name}`).getByRole("button").first();
}

/** Tap a chore's tile and return its sheet. */
export async function openChore(page: Page, name: string): Promise<Locator> {
  await tile(page, name).click();
  const sheet = page.getByRole("dialog", { name: `Log ${name}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * The signed-in `member` logs each named chore as done `minutesAgo` before
 * the server's now, through MCP's log_completion (the pages always log
 * "now"). That gives a chore a rhythm: a chore never done is never urgent
 * (SPEC §12 decision 22), one done a day ago on a one-day rhythm is.
 */
export async function logDoneAgo(
  member: Page,
  request: APIRequestContext,
  names: string[],
  minutesAgo: number,
) {
  const { tokens } = await connect(
    member,
    request,
    `E2E backdate ${Math.random().toString(36).slice(2, 8)}`,
    { write: true },
  );
  const token = tokens.access_token;
  const { json: board } = await callTool<{
    chores: { id: string; name: string }[];
  }>(request, token, "list_chores");
  const { now } = await serverClock(member);
  const occurredAt = new Date(
    Date.parse(now) - minutesAgo * 60_000,
  ).toISOString();
  for (const name of names) {
    const chore = board.chores.find((c) => c.name === name);
    expect(chore, `${name} is on the board`).toBeDefined();
    const logged = await callTool(request, token, "log_completion", {
      choreId: chore!.id,
      occurredAt,
    });
    expect(logged.result.isError, `logging ${name}`).toBeUndefined();
  }
}
