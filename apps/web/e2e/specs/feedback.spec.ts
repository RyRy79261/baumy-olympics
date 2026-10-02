import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { founderEmail } from "../lib/accounts";
import { founderAdmin } from "../lib/household";
import { openKioskChores, pairedKiosk } from "../lib/kiosk";

// Issue #133: shake to report a bug. A shake (devicemotion events, as a
// phone or the kitchen iPad sends them) opens the reporter; a report is
// filed on the fake GitHub tracker (lib/integrations/github-memory.ts),
// redacted and naming nobody; an uncaught error offers "Report this bug"
// once, and "Not now" holds it; on the kiosk a report needs someone picked.

const rand = () => Math.random().toString(36).slice(2, 8);

/** Shake the device: six jolts, 80 ms apart (the hook samples every 60). */
async function shake(page: Page) {
  await page.evaluate(async () => {
    for (const z of [9.8, 25, 9.8, 25, 9.8, 25, 9.8]) {
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          accelerationIncludingGravity: { x: 0, y: 0, z },
        }),
      );
      await new Promise((r) => setTimeout(r, 80));
    }
  });
}

/** Shake until the reporter is up (the listener attaches on hydration). */
async function shakeOpen(page: Page, title = "Report a bug") {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(async () => {
    await shake(page);
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

async function filedIssue(request: APIRequestContext, marker: string) {
  const res = await request.get("/api/test/github");
  expect(res.status()).toBe(200);
  const { issues } = (await res.json()) as {
    issues: { title: string; body: string; labels: string[] }[];
  };
  const issue = issues.find((i) => i.body.includes(marker));
  expect(issue, `an issue mentioning ${marker}`).toBeDefined();
  return issue!;
}

test("a shake opens the reporter, and the issue it files is redacted and names nobody", async ({
  page,
  request,
}, testInfo) => {
  const project = testInfo.project.name;
  await founderAdmin(page, project);
  const marker = `marker-${rand()}`;
  const address = `someone-${rand()}@example.com`;

  const dialog = await shakeOpen(page);
  await dialog
    .getByLabel("What went wrong?")
    .fill(`The hub froze ${marker}\nmail me at ${address}`);
  await dialog.getByLabel("Attach device details and recent errors").check();
  await expect(dialog.getByText("Browser", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Send report" }).click();

  const filed = page.getByRole("dialog", { name: "Report filed" });
  await expect(filed.getByText(/Issue #\d+ is on the tracker/)).toBeVisible();
  await expect(
    filed.getByRole("link", { name: /View issue #\d+/ }),
  ).toHaveAttribute("href", /github\.com\/e2e\/fake-tracker\/issues\/\d+/);

  const issue = await filedIssue(request, marker);
  expect(issue.title).toBe(`The hub froze ${marker}`);
  expect(issue.labels).toEqual(["bug", "source:in-app"]);
  // Present before absent: redaction ran, and the address is gone.
  expect(issue.body).toContain("[email]");
  expect(issue.body).not.toContain(address);
  // The device details went, inside the fold.
  expect(issue.body).toContain("Device details and recent errors");
  // The reporter is an opaque id, never the founder's name or email.
  expect(issue.body).toMatch(/reporter: `[0-9a-f-]{36}`/);
  expect(issue.body).not.toContain(`Founder ${project}`);
  expect(issue.body).not.toContain(founderEmail(project));

  await filed.getByRole("button", { name: "Done" }).click();
  await expect(filed).toBeHidden();
});

test("Settings explains what a report sends, and opens the reporter", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  await page.goto("/settings");
  const card = page.getByTestId("report-settings-card");
  await expect(card).toContainText("Your name and email are never in it");
  await card
    .getByRole("button", { name: "What a bug report attaches" })
    .click();
  await expect(card.getByText("Browser", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Request a feature" }).click();
  const dialog = page.getByRole("dialog", { name: "Request a feature" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("an uncaught error offers Report this bug once, and Not now holds it", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  await page.goto("/settings");
  const offer = page.getByTestId("report-offer");
  const boom = () =>
    page.evaluate(() => {
      setTimeout(() => {
        throw new Error("e2e boom");
      });
    });
  // Wait for the reporter to be listening (hydration), then break something.
  await expect(async () => {
    await boom();
    await expect(offer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(offer).toContainText("Something went wrong on this page.");
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toBeHidden();
  // An error loop does not bring it back.
  await boom();
  await boom();
  await page.waitForTimeout(500);
  await expect(offer).toBeHidden();
});

test("on the kitchen screen, a shake reports as the member acting", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  await founderAdmin(page, project);
  const ipad = await pairedKiosk(browser, page, `iPad ${rand()}`);
  const kiosk = ipad.page;

  // Nobody picked: the reporter opens, and says who has to tap in first.
  const blocked = await shakeOpen(kiosk);
  await expect(blocked.getByText(/Tap your avatar first/)).toBeVisible();
  await expect(
    blocked.getByRole("button", { name: "Send report" }),
  ).toHaveCount(0);
  await blocked.getByRole("button", { name: "Cancel" }).click();
  await expect(blocked).toBeHidden();

  await openKioskChores(kiosk);
  await kiosk
    .getByRole("button", { name: `Founder ${project}`, exact: true })
    .click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(`Founder ${project}`);
  const marker = `kiosk-${rand()}`;
  const dialog = await shakeOpen(kiosk);
  await dialog.getByLabel("What went wrong?").fill(`Shop is blank ${marker}`);
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(
    kiosk.getByRole("dialog", { name: "Report filed" }),
  ).toBeVisible();

  const issue = await filedIssue(request, marker);
  expect(issue.body).toContain("on the kitchen screen");
  expect(issue.body).not.toContain(`Founder ${project}`);
  await ipad.context.close();
});
