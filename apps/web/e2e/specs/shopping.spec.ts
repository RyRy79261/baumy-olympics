import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { founderAdmin } from "../lib/household";
import { expectKioskTargets, pairCode } from "../lib/kiosk";

// Issue #26, with the fake brain (lib/integrations/brain-memory.ts) and
// /api/test/brain standing in for the house Telegram group, which writes
// brain's list without going through Olympics:
//
// - something added in "Telegram" shows on the kitchen screen at its next
//   60-second re-read, which skips the 30s cache; and what the kiosk adds or
//   ticks off, "Telegram" sees at once;
// - with brain down (the `baumy_e2e_brain=down` cookie, for this browser
//   only), the widget says the list is unavailable and the rest of the hub
//   works;
// - "Baumy, add milk and eggs" is one proposal with both items.
//
// The fake list is shared by the specs running in parallel, so each item
// has a name of its own.

const HUB_REFRESH_MS = 60_000;

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
  test.skip(project !== "ipad-landscape", "The kiosk is an iPad in landscape.");
  const tag = Math.random().toString(36).slice(2, 8);
  const oatMilk = `Oat milk ${tag}`;
  const eggs = `Eggs ${tag}`;
  const bread = `Bread ${tag}`;
  const founder = `Founder ${project}`;

  await founderAdmin(page, project);
  const code = await pairCode(page, `iPad ${tag}`);
  // The iPad's own clock, so a spec can step to its next 60s re-read.
  const ipad = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
  });
  await ipad.clock.install();
  const kiosk = await ipad.newPage();
  await kiosk.goto("/kiosk/pair");
  await kiosk.getByLabel("Pairing code").fill(code);
  await kiosk.getByRole("button", { name: "Pair this kiosk" }).click();
  await expect(kiosk).toHaveURL(/\/kiosk$/);

  // Before anyone taps in: the list can be read, not changed.
  const widget = kiosk.getByTestId("widget-shopping");
  await expect(widget).toBeVisible();
  await expect(widget).toHaveAttribute("data-status", "ready");
  await expect(widget.getByLabel("Add to the list")).toHaveCount(0);
  await expect(row(widget, oatMilk)).toHaveCount(0);

  // Added in Telegram: the kiosk shows it at its next re-read, although the
  // server read the list moments ago (and would keep it for 30 seconds).
  await telegramSays(page.request, { add: [oatMilk] });
  await ipad.clock.fastForward(HUB_REFRESH_MS);
  await expect(row(widget, oatMilk)).toBeVisible();

  // Someone taps in and adds two things at once, with no PIN.
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  await widget.getByLabel("Add to the list").fill(`${eggs}, ${bread}`);
  await widget.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    kiosk
      .getByRole("status")
      .filter({ hasText: `Added ${eggs} and ${bread}.` }),
  ).toBeVisible();
  await expect(row(widget, eggs)).toBeVisible();
  await expect(row(widget, bread)).toBeVisible();
  await expect(widget.getByLabel("Add to the list")).toHaveValue("");
  await expectKioskTargets(widget);
  // Telegram sees them at once.
  expect(await telegram(page.request)).toEqual(
    expect.arrayContaining([oatMilk, eggs, bread]),
  );

  // Ticked off in Telegram: gone from the kiosk at its next re-read.
  await telegramSays(page.request, { checkOff: [eggs] });
  await ipad.clock.fastForward(HUB_REFRESH_MS);
  await expect(row(widget, oatMilk)).toBeVisible();
  await expect(row(widget, eggs)).toHaveCount(0);

  // The whole list has a page of its own, where one tap ticks an item off,
  // here and in Telegram. (The minute idle forgot who was acting.)
  await widget.getByRole("link", { name: "List" }).click();
  await expect(
    kiosk.getByRole("heading", { name: "Shopping list", level: 1 }),
  ).toBeVisible();
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  await kiosk
    .getByRole("button", { name: `Check off ${oatMilk}`, exact: true })
    .click();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Checked off ${oatMilk}.` }),
  ).toBeVisible();
  await expect(row(kiosk, bread)).toBeVisible();
  await expect(row(kiosk, oatMilk)).toHaveCount(0);
  expect(await telegram(page.request)).not.toContain(oatMilk);
  await expectKioskTargets(kiosk.locator("main"));

  await ipad.close();
});

test("with brain down the widget says so, and the rest of the hub works", async ({
  page,
  context,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-landscape", "The kiosk has its own spec.");
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
