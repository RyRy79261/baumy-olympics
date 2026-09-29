import { expect, test, type APIRequestContext } from "@playwright/test";
import { founderAdmin } from "../lib/household";
import { mintServiceToken, revokeServiceToken } from "../lib/service-token";

// Issue #27 end to end, against Docker Postgres: baumy-brain's side of
// /api/v1/actions, played by Playwright's request context. The token comes
// from the real mint script; the link code from /settings, as a member makes
// it; the calendar is the in-memory fake of E2E_TEST_MODE.
//
// Both tests link this project's founder to a Telegram id of their own, so
// they run one after the other.

test.describe.configure({ mode: "serial" });

const rand = () => Math.random().toString(36).slice(2, 8);
/** A Telegram user id nobody else in this run uses. */
const tgId = () => 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

interface Brain {
  request: APIRequestContext;
  token: string;
}

function call(
  brain: Brain,
  name: string,
  input: unknown,
  headers: Record<string, string>,
) {
  return brain.request.post(`/api/v1/actions/${name}`, {
    headers: {
      authorization: `Bearer ${brain.token}`,
      ...headers,
    },
    data: input,
  });
}

test("brain links a member by code, then adds a confirmed calendar event once", async ({
  page,
  request,
}, testInfo) => {
  const project = testInfo.project.name;
  await founderAdmin(page, project);
  const tokenName = `e2e-brain-${rand()}`;
  const brain: Brain = { request, token: mintServiceToken(tokenName) };
  const tg = tgId();
  const actor = { "x-baumy-actor": `tg:${tg}` };

  // The tool list carries each action's risk, destructive ones included.
  const list = await request.get("/api/v1/actions", {
    headers: { authorization: `Bearer ${brain.token}` },
  });
  expect(list.status()).toBe(200);
  const { actions } = (await list.json()) as {
    actions: { name: string; risk: string }[];
  };
  expect(actions.find((a) => a.name === "create_event")?.risk).toBe("confirm");
  expect(actions.find((a) => a.name === "delete_event")?.risk).toBe(
    "destructive",
  );
  expect(actions.map((a) => a.name)).not.toContain("manage_members");

  // Not linked yet: only link_telegram works.
  const early = await call(brain, "whoami", {}, actor);
  expect(early.status()).toBe(403);
  expect((await early.json()).code).toBe("TELEGRAM_NOT_LINKED");

  await page.goto("/settings");
  await page.getByRole("button", { name: "Create a link code" }).click();
  const shown = await page.getByTestId("telegram-link-code").textContent();
  const code = /\/link ([A-Z2-9]{10})/.exec(shown ?? "")![1]!;

  const wrong = await call(
    brain,
    "link_telegram",
    { code: "WRONGCODE2" },
    { ...actor, "idempotency-key": `link-${rand()}-wrong` },
  );
  expect(wrong.status()).toBe(422);
  expect((await wrong.json()).code).toBe("LINK_CODE_INVALID");

  const linked = await call(
    brain,
    "link_telegram",
    { code },
    { ...actor, "idempotency-key": `link-${rand()}-ok` },
  );
  expect(linked.status()).toBe(200);
  expect((await linked.json()).data.displayName).toBe(`Founder ${project}`);

  // The code is spent, even for someone else.
  const reused = await call(
    brain,
    "link_telegram",
    { code },
    { "x-baumy-actor": `tg:${tgId()}`, "idempotency-key": `link-${rand()}-re` },
  );
  expect((await reused.json()).code).toBe("LINK_CODE_INVALID");

  const me = await call(brain, "whoami", {}, actor);
  expect(me.status()).toBe(200);
  expect((await me.json()).data.actorKind).toBe("service");

  // A confirm-risk write needs X-Baumy-Confirmed: 1.
  const title = `Brain dinner ${rand()}`;
  const event = {
    title,
    kind: "timed",
    date: "2027-02-10",
    startTime: "19:00",
    endTime: "20:00",
  };
  const key = { "idempotency-key": `event-${rand()}-0001` };
  const unconfirmed = await call(brain, "create_event", event, {
    ...actor,
    ...key,
  });
  expect(unconfirmed.status()).toBe(428);
  expect((await unconfirmed.json()).code).toBe("CONFIRMATION_REQUIRED");

  const confirmed = { ...actor, ...key, "x-baumy-confirmed": "1" };
  const created = await call(brain, "create_event", event, confirmed);
  expect(created.status()).toBe(200);
  const first = await created.json();
  // Brain retries with the same key: the same answer, and no second event.
  const again = await call(brain, "create_event", event, confirmed);
  expect(await again.json()).toEqual(first);

  await page.goto("/calendar?view=week&date=2027-02-10");
  await expect(
    page.getByRole("button", { name: new RegExp(`^${title}, `) }),
  ).toHaveCount(1);

  // A destructive action needs the confirm tap too (issue #70).
  const eventId = (first as { data: { event: { id: string } } }).data.event.id;
  const deleteKey = { "idempotency-key": `delete-${rand()}-0001` };
  const unconfirmedDelete = await call(
    brain,
    "delete_event",
    { eventId },
    { ...actor, ...deleteKey },
  );
  expect(unconfirmedDelete.status()).toBe(428);
  const deleted = await call(
    brain,
    "delete_event",
    { eventId },
    { ...actor, ...deleteKey, "x-baumy-confirmed": "1" },
  );
  expect(deleted.status()).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("button", { name: new RegExp(`^${title}, `) }),
  ).toHaveCount(0);

  // Admin actions are not brain's.
  const admin = await call(
    brain,
    "manage_members",
    {},
    {
      ...actor,
      "x-baumy-confirmed": "1",
      "idempotency-key": `x-${rand()}-01`,
    },
  );
  expect(admin.status()).toBe(403);
  expect((await admin.json()).code).toBe("SURFACE_FORBIDDEN");

  // A revoked token stops working on its next request.
  revokeServiceToken(tokenName);
  const revoked = await call(brain, "whoami", {}, actor);
  expect(revoked.status()).toBe(401);
});

test("an admin sets and clears a member's Telegram id by hand", async ({
  page,
  request,
}, testInfo) => {
  const project = testInfo.project.name;
  await founderAdmin(page, project);
  const tokenName = `e2e-brain-${rand()}`;
  const brain: Brain = { request, token: mintServiceToken(tokenName) };
  const tg = tgId();
  const actor = { "x-baumy-actor": `tg:${tg}` };

  await page.goto("/admin/members");
  const row = page.getByTestId(`member-Founder ${project}`);
  await row.locator("summary", { hasText: "Telegram" }).click();
  const field = row.getByLabel("Telegram user id", { exact: true });
  await field.fill("not a number");
  await expect(row.getByText("Use the Telegram user id")).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Save Telegram id" }),
  ).toBeDisabled();

  await field.fill(String(tg));
  await row.getByRole("button", { name: "Save Telegram id" }).click();
  await expect(row.getByText("Telegram id saved.")).toBeVisible();
  const me = await call(brain, "whoami", {}, actor);
  expect(me.status()).toBe(200);
  expect((await me.json()).data.displayName).toBe(`Founder ${project}`);

  await page.reload();
  await row.locator("summary", { hasText: "Telegram" }).click();
  await expect(field).toHaveValue(String(tg));
  await field.fill("");
  await row.getByRole("button", { name: "Save Telegram id" }).click();
  await expect(row.getByText("Telegram unlinked.")).toBeVisible();
  const gone = await call(brain, "whoami", {}, actor);
  expect(gone.status()).toBe(403);
  revokeServiceToken(tokenName);
});
