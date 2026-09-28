import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { founderAdmin } from "../lib/household";
import { expectKioskTargets, kioskNav, pairedKiosk } from "../lib/kiosk";

// Issue #26, with the fake brain (lib/integrations/brain-memory.ts) and
// /api/test/brain standing in for the house Telegram group, which writes
// brain's list without going through Olympics:
//
// - something added in "Telegram" shows on the kitchen screen's Shop page
//   at its next re-read, which skips the 30s cache; and what the kiosk adds
//   or ticks off, "Telegram" sees at once;
// - with brain down (the `baumy_e2e_brain=down` cookie, for this browser
//   only), the widget says the list is unavailable and the rest of the hub
//   works;
// - "Baumy, add milk and eggs" is one proposal with both items.
//
// The fake list is shared by the specs running in parallel, so each item
// has a name of its own.

/** The kiosk page re-reads itself, as it does coming back into view. */
async function rereads(kiosk: Page) {
  await kiosk.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function telegram(request: APIRequestContext) {
  const res = await request.get("/api/test/brain");
  expect(res.status(), "is the server running with E2E_TEST_MODE=1?").toBe(200);
  const body = (await res.json()) as { items: { item: string }[] };
  return body.items.map((i) => i.item);
}

async function telegramSays(
  request: APIRequestContext,
  data: { add: string[] } | { checkOff: string[] },
) {
  const res = await request.post("/api/test/brain", { data });
  expect(res.status()).toBe(200);
}

function row(scope: Locator | Page, item: string): Locator {
  return scope.getByTestId(`shopping-item-${item}`);
}

test("the kitchen screen and Telegram share one shopping list", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const tag = Math.random().toString(36).slice(2, 8);
  const oatMilk = `Oat milk ${tag}`;
  const eggs = `Eggs ${tag}`;
  const bread = `Bread ${tag}`;
  const founder = `Founder ${project}`;

  await founderAdmin(page, project);
  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${tag}`,
  );

  // The list is the footer's Shop (ADR 0005: the home is the dashboard).
  // Before anyone taps in it can be read, not changed.
  await kioskNav(kiosk, "Shop");
  await expect(
    kiosk.getByRole("heading", { name: "Shopping list", level: 1 }),
  ).toBeVisible();
  const list = kiosk.locator("main");
  await expect(
    kiosk.getByText("Tap your avatar at the top to add or tick off items."),
  ).toBeVisible();
  await expect(list.getByLabel("Add to the list")).toHaveCount(0);
  await expect(row(list, oatMilk)).toHaveCount(0);

  // Added in Telegram: the kiosk shows it at its next re-read (here, coming
  // back into view), although the server read the list moments ago (and
  // would keep it for 30 seconds).
  await telegramSays(page.request, { add: [oatMilk] });
  await rereads(kiosk);
  await expect(row(list, oatMilk)).toBeVisible();

  // Someone taps in and adds two things at once, with no PIN.
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  await list.getByLabel("Add to the list").fill(`${eggs}, ${bread}`);
  await list.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    kiosk
      .getByRole("status")
      .filter({ hasText: `Added ${eggs} and ${bread}.` }),
  ).toBeVisible();
  await expect(row(list, eggs)).toBeVisible();
  await expect(row(list, bread)).toBeVisible();
  await expect(list.getByLabel("Add to the list")).toHaveValue("");
  await expectKioskTargets(list);
  // Telegram sees them at once.
  expect(await telegram(page.request)).toEqual(
    expect.arrayContaining([oatMilk, eggs, bread]),
  );

  // Ticked off in Telegram: gone from the kiosk at its next re-read.
  await telegramSays(page.request, { checkOff: [eggs] });
  await rereads(kiosk);
  await expect(row(list, oatMilk)).toBeVisible();
  await expect(row(list, eggs)).toHaveCount(0);

  // One tap ticks an item off, here and in Telegram.
  await kiosk
    .getByRole("button", { name: `Check off ${oatMilk}`, exact: true })
    .click();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Checked off ${oatMilk}.` }),
  ).toBeVisible();
  await expect(row(kiosk, bread)).toBeVisible();
  await expect(row(kiosk, oatMilk)).toHaveCount(0);
  expect(await telegram(page.request)).not.toContain(oatMilk);

  await context.close();
});

test("with brain down the widget says so, and the rest of the hub works", async ({
  page,
  context,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-portrait", "The kiosk has its own spec.");
  const tag = Math.random().toString(36).slice(2, 8);
  const tea = `Tea ${tag}`;
  const coffee = `Coffee ${tag}`;

  await founderAdmin(page, project);

  // Brain is down for this browser only.
  await context.addCookies([
    {
      name: "baumy_e2e_brain",
      value: "down",
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.goto("/");
  const widget = page.getByTestId("widget-shopping");
  await expect(widget).toHaveAttribute("data-status", "unavailable");
  await expect(widget.getByRole("alert")).toHaveText(
    /The shopping list is unavailable right now/,
  );
  for (const id of ["widget-chores", "widget-leaderboard", "widget-notes"]) {
    await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId(id)).not.toHaveAttribute(
      "data-status",
      "unavailable",
    );
  }
  await expect(page.getByTestId("hub-pot")).toContainText("Pot: €");
  await page.goto("/shopping");
  await expect(
    page.getByText(/The shopping list is unavailable right now/),
  ).toBeVisible();

  // Brain is back: /shopping works end to end, and so does the widget.
  await context.clearCookies({ name: "baumy_e2e_brain" });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Shopping list", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Add to the list").fill(`${tea}, ${coffee}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `Added ${tea} and ${coffee}.` }),
  ).toBeVisible();
  await expect(row(page, tea)).toBeVisible();
  await expect(row(page, coffee)).toBeVisible();
  await page
    .getByRole("button", { name: `Check off ${tea}`, exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: `Checked off ${tea}.` }),
  ).toBeVisible();
  await expect(row(page, tea)).toHaveCount(0);
  const seen = await telegram(page.request);
  expect(seen).toContain(coffee);
  expect(seen).not.toContain(tea);
  await page.goto("/");
  await expect(widget).toHaveAttribute("data-status", "ready");
  await expect(row(widget, coffee)).toBeVisible();
});

test("'Baumy, add milk and eggs' is one proposal with both items", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "desktop-chromium", "Once is enough.");
  const tag = Math.random().toString(36).slice(2, 8);
  const milk = `milk ${tag}`;
  const eggs = `eggs ${tag}`;

  await founderAdmin(page, project);
  await page.getByRole("button", { name: "Ask Baumy" }).click();
  const sheet = page.getByRole("dialog", { name: "Ask Baumy" });
  await sheet
    .getByLabel("Message to Baumy")
    .fill(`Baumy, add ${milk} and ${eggs}`);
  await sheet.getByRole("button", { name: "Send" }).click();

  const proposal = sheet.getByTestId("proposal-add_shopping_items");
  await expect(proposal).toHaveCount(1);
  await expect(proposal).toContainText(
    `Add ${milk} and ${eggs} to the shopping list`,
  );
  // Nothing is on the list until it is approved.
  expect(await telegram(page.request)).not.toContain(milk);
  await proposal.getByRole("button", { name: "Approve" }).click();
  await expect(proposal.getByTestId("proposal-state")).toHaveText("Done");
  expect(await telegram(page.request)).toEqual(
    expect.arrayContaining([milk, eggs]),
  );
  await sheet.getByRole("button", { name: "Close" }).click();
  await page.goto("/shopping");
  await expect(row(page, milk)).toBeVisible();
  await expect(row(page, eggs)).toBeVisible();
});
