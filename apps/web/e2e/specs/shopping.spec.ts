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

  // Issue #204: with nobody picked it is the same framed row as once
  // someone is picked (56px tall, its empty box), only to read: nothing in
  // the list is a button, and the line is said once.
  const items = list.getByTestId("shopping-items");
  await expect(row(list, oatMilk)).toHaveText(oatMilk);
  const readOnly = await row(list, oatMilk).locator("> div").boundingBox();
  expect(readOnly!.height).toBeGreaterThanOrEqual(56);
  await expect(items.locator("li").first()).toBeVisible();
  await expect(items.getByRole("button")).toHaveCount(0);
  await expect(
    kiosk.getByRole("button", { name: `Check off ${oatMilk}` }),
  ).toHaveCount(0);
  await expect(
    kiosk.getByText("Tap your avatar at the top to add or tick off items."),
  ).toHaveCount(1);

  // Someone taps in and adds two things at once, with no PIN.
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  // The same row is now the check-off button, the same size.
  const tick = kiosk.getByRole("button", {
    name: `Check off ${oatMilk}`,
    exact: true,
  });
  await expect(tick).toBeVisible();
  expect(
    Math.abs((await tick.boundingBox())!.height - readOnly!.height),
  ).toBeLessThanOrEqual(1);
  await expect(
    kiosk.getByText("Tap your avatar at the top to add or tick off items."),
  ).toHaveCount(0);
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

/** Brain sorts an item by itself (or a housemate picks its group in Telegram). */
async function brainSorts(
  request: APIRequestContext,
  item: string,
  category: string | null,
) {
  const res = await request.post("/api/test/brain", {
    data: { sort: { item, category } },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ outcome: "set" });
}

async function telegramGroups(request: APIRequestContext) {
  const res = await request.get("/api/test/brain");
  const body = (await res.json()) as {
    items: { item: string; category: string | null }[];
  };
  return Object.fromEntries(body.items.map((i) => [i.item, i.category]));
}

function group(scope: Locator | Page, key: string): Locator {
  return scope.getByTestId(`shopping-group-${key}`);
}

// Issue #208: the list under its groups' headings, read-only and picked; a
// picked member moves an item with the big group buttons and adds straight
// into a group, and brain (here the fake) has both at once.
test("the kitchen screen shows the shopping list in its groups, and moves and adds into them", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const tag = Math.random().toString(36).slice(2, 8);
  const oatMilk = `Oat milk ${tag}`;
  const beans = `Beans ${tag}`;
  const eggs = `Eggs ${tag}`;
  const founder = `Founder ${project}`;

  await founderAdmin(page, project);
  // Added in Telegram; brain sorted the oat milk, not yet the beans.
  await telegramSays(page.request, { add: [oatMilk, beans] });
  await brainSorts(page.request, oatMilk, "fresh");
  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${tag}`,
  );

  // Nobody picked: the groups are there to read, each with its icon. The
  // re-read skips the server's 30s cache, which other specs may have filled.
  await kioskNav(kiosk, "Shop");
  await expect(
    kiosk.getByRole("heading", { name: "Shopping list", level: 1 }),
  ).toBeVisible();
  await rereads(kiosk);
  const list = kiosk.locator("main");
  const fresh = group(list, "fresh");
  const unsorted = group(list, "none");
  await expect(
    fresh.getByRole("heading", { name: "Fresh", exact: true }),
  ).toBeVisible();
  await expect(fresh.locator('svg[data-glyph="fridge"]')).toBeVisible();
  await expect(row(fresh, oatMilk)).toBeVisible();
  await expect(
    unsorted.getByRole("heading", { name: "Not sorted", exact: true }),
  ).toBeVisible();
  await expect(row(unsorted, beans)).toBeVisible();
  await expect(
    list.getByTestId("shopping-items").getByRole("button"),
  ).toHaveCount(0);
  // Not sorted is the last heading.
  const headings = list.getByTestId("shopping-items").getByRole("heading");
  await expect(headings.last()).toHaveText("Not sorted");

  // Someone taps in and moves the beans to Coffee with the big buttons.
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  const move = list.getByRole("button", {
    name: `Change the group of ${beans}`,
    exact: true,
  });
  // Into the middle of the screen, as a finger would scroll it, so Baumy in
  // the corner is not over it (the list ends with room for that).
  await move.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await move.click();
  const picker = kiosk.getByRole("dialog", { name: `Group for ${beans}` });
  await expect(picker).toBeVisible();
  await expect(
    picker.getByRole("button", { name: "Not sorted", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectKioskTargets(picker);
  await picker.getByRole("button", { name: "Coffee", exact: true }).click();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Put ${beans} under Coffee.` }),
  ).toBeVisible();
  await expect(picker).toHaveCount(0);
  const coffee = group(list, "coffee");
  await expect(
    coffee.getByRole("heading", { name: "Coffee", exact: true }),
  ).toBeVisible();
  await expect(row(coffee, beans)).toBeVisible();
  await expect(row(unsorted, beans)).toHaveCount(0);
  expect((await telegramGroups(page.request))[beans]).toBe("coffee");

  // Adds straight into Fresh: pick the group, type, Add.
  const addGroups = list.getByRole("group", {
    name: "Add into a group (optional)",
  });
  await addGroups.getByRole("button", { name: "Fresh", exact: true }).click();
  await expect(
    addGroups.getByRole("button", { name: "Fresh", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await list.getByLabel("Add to Fresh").fill(eggs);
  await list.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Added ${eggs} to Fresh.` }),
  ).toBeVisible();
  await expect(row(fresh, eggs)).toBeVisible();
  await expect(row(fresh, oatMilk)).toBeVisible();
  expect((await telegramGroups(page.request))[eggs]).toBe("fresh");
  // The pick is forgotten once it is used.
  await expect(list.getByLabel("Add to the list")).toHaveValue("");
  await expectKioskTargets(list);

  await context.close();
});

// Issue #208 on the phone: the same groups and buttons on /shopping.
test("the phone's shopping list moves an item into a group and adds into one", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "mobile-360", "Once is enough, on the phone.");
  const tag = Math.random().toString(36).slice(2, 8);
  const bleach = `Bleach ${tag}`;
  const bulbs = `Bulbs ${tag}`;

  await founderAdmin(page, project);
  // Added here (not in "Telegram"), so the server's 30s read cache, which
  // other specs may have filled, is cleared by our own write.
  await page.goto("/shopping");
  await page.getByLabel("Add to the list").fill(bleach);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(row(page, bleach)).toBeVisible();
  await page
    .getByRole("button", { name: `Change the group of ${bleach}`, exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: `Group for ${bleach}` });
  await picker.getByRole("button", { name: "Cleaning", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `Put ${bleach} under Cleaning.` }),
  ).toBeVisible();
  await expect(row(group(page, "cleaning"), bleach)).toBeVisible();

  await page
    .getByRole("group", { name: "Add into a group (optional)" })
    .getByRole("button", { name: "Maintenance", exact: true })
    .click();
  await page.getByLabel("Add to Maintenance").fill(bulbs);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(row(group(page, "maintenance"), bulbs)).toBeVisible();
  // And back to Not sorted.
  await page
    .getByRole("button", { name: `Change the group of ${bulbs}`, exact: true })
    .click();
  await page
    .getByRole("dialog", { name: `Group for ${bulbs}` })
    .getByRole("button", { name: "Not sorted", exact: true })
    .click();
  await expect(row(group(page, "none"), bulbs)).toBeVisible();
  expect((await telegramGroups(page.request))[bulbs]).toBeNull();
});

// Issue #204: before anyone is picked, brain being down is still its own
// sentence on the kitchen screen's Shop page, not a broken page.
test("with brain down the kitchen screen's Shop page says so before anyone is picked", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const tag = Math.random().toString(36).slice(2, 8);

  await founderAdmin(page, project);
  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${tag}`,
  );
  await context.addCookies([
    { name: "baumy_e2e_brain", value: "down", domain: "localhost", path: "/" },
  ]);
  await kioskNav(kiosk, "Shop");
  await expect(
    kiosk.getByRole("heading", { name: "Shopping list", level: 1 }),
  ).toBeVisible();
  await expect(
    kiosk.getByText(/The shopping list is unavailable right now/),
  ).toBeVisible();
  await expect(kiosk.getByTestId("acting-as")).toHaveCount(0);
  await expect(kiosk.getByTestId("shopping-items")).toHaveCount(0);

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
  for (const id of ["widget-events", "widget-leaderboard", "widget-notes"]) {
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

test("with brain slow the hub shows everything else first, then the list", async ({
  page,
  context,
}, testInfo) => {
  // Issue #128: a cold brain took seconds and held the whole hub. The page
  // now streams the shopping widget in; nothing else waits for it.
  const project = testInfo.project.name;
  test.skip(project !== "desktop-chromium", "Once is enough.");
  await founderAdmin(page, project);

  // Slow for this browser only (BRAIN_SLOW_MS, lib/integrations/brain-memory.ts).
  await context.addCookies([
    { name: "baumy_e2e_brain", value: "slow", domain: "localhost", path: "/" },
  ]);
  // "commit": the page is there before its last streamed part arrives.
  await page.goto("/", { waitUntil: "commit" });
  const widget = page.getByTestId("widget-shopping");
  await expect(widget).toHaveAttribute("data-status", "loading");
  await expect(widget).toHaveAttribute("aria-busy", "true");
  await expect(widget).toContainText("Loading…");
  for (const id of ["widget-events", "widget-leaderboard", "widget-notes"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("hub-pot")).toContainText("Pot: €");
  await expect(widget).toHaveAttribute("data-status", "loading");

  // Then the list streams in, with its quick-add field.
  await expect(widget).toHaveAttribute("data-status", "ready", {
    timeout: 15_000,
  });
  await expect(widget).not.toHaveAttribute("aria-busy", "true");
  await expect(widget.getByLabel("Add to the list")).toBeVisible();
  await expect(widget).not.toContainText("Loading…");
  await context.clearCookies({ name: "baumy_e2e_brain" });
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

  const proposal = sheet.getByTestId("suggestion-add_shopping_items");
  await expect(proposal).toHaveCount(1);
  await expect(proposal).toContainText(
    `Add ${milk} and ${eggs} to the shopping list`,
  );
  // Nothing is on the list until it is approved.
  expect(await telegram(page.request)).not.toContain(milk);
  await sheet.getByRole("button", { name: "Confirm all" }).click();
  await expect(proposal.getByTestId("proposal-state")).toHaveText("Done");
  expect(await telegram(page.request)).toEqual(
    expect.arrayContaining([milk, eggs]),
  );
  await sheet.getByRole("button", { name: "Done" }).click();
  await page.goto("/shopping");
  await expect(row(page, milk)).toBeVisible();
  await expect(row(page, eggs)).toBeVisible();
});
