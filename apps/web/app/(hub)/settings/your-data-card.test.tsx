import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatBerlinDateTime, PHOTO_RETENTION_DAYS } from "@baumy/core";
import type { MyDataView } from "@/lib/actions/get-my-data";
import { RETENTION } from "@/lib/privacy/retention";
import { YourDataCard } from "./your-data-card";

// Settings, "Your data" (issue #144): get_my_data's counts and dates, the
// retention rules from the privacy page's constants, and the policy link.

const DELETES = "2026-12-26T10:00:00.000Z";
const USED = "2026-09-27T09:00:00.000Z";

function view(over: Partial<MyDataView> = {}): MyDataView {
  return {
    account: {
      emailVerified: true,
      hasPassword: true,
      googleLinked: true,
      passkeys: 2,
      twoFactorEnabled: true,
    },
    sessions: { count: 2, lastUsedAt: [USED, "2026-09-26T09:00:00.000Z"] },
    profile: {
      displayName: "Ryan",
      color: "#336699",
      role: "member",
      memberSince: "2026-01-02T10:00:00.000Z",
      characterPicked: false,
      kioskPinSet: true,
      telegramLinked: true,
    },
    completions: {
      total: 5,
      byStatus: {
        pending: 1,
        confirmed: 1,
        finalized: 2,
        disputed: 1,
        voided: 0,
      },
    },
    notes: { written: 3, deletedKept: 1 },
    photos: {
      stored: 2,
      items: [
        { attachedAt: USED, deletesAt: DELETES },
        { attachedAt: USED, deletesAt: null },
      ],
    },
    auditEntries: 12,
    ai: {
      commands: 4,
      inputTokens: 300,
      outputTokens: 50,
      voiceClips: 1,
      voiceSeconds: 2,
      lastUsedAt: USED,
    },
    connectedApps: [{ name: "Claude", connectedAt: USED, lastUsedAt: null }],
    retention: RETENTION,
    ...over,
  };
}

const render = (v: MyDataView) =>
  renderToStaticMarkup(<YourDataCard data={v} />);

describe("YourDataCard", () => {
  it("shows every count and date, the retention rules and the privacy link", () => {
    const html = render(view());
    expect(html).toContain("Your data");
    expect(html).toContain("password, Google, 2 passkeys; two-factor on");
    expect(html).toContain(
      `2, last used ${formatBerlinDateTime(new Date(USED))}`,
    );
    expect(html).toContain("Telegram linked; kiosk PIN set");
    expect(html).toContain("5 (2 still open)");
    expect(html).toContain("3 written, 1 deleted but kept");
    expect(html).toContain(
      `2; the next is deleted ${formatBerlinDateTime(new Date(DELETES))}; 1 on a claim still open, deleted ${PHOTO_RETENTION_DAYS} days after settling`,
    );
    expect(html).toContain(">12<");
    expect(html).toContain("4 commands (350 tokens), 1 voice clip");
    expect(html).toContain(">Claude<");
    expect(html).toContain(`deleted ${PHOTO_RETENTION_DAYS} days after`);
    for (const rule of RETENTION.rules) {
      expect(html).toContain(rule.replace(/'/g, "&#x27;"));
    }
    expect(html).toContain('href="/privacy"');
  });

  it("says none for what is not there", () => {
    const html = render(
      view({
        account: {
          emailVerified: false,
          hasPassword: false,
          googleLinked: false,
          passkeys: 0,
          twoFactorEnabled: false,
        },
        sessions: { count: 0, lastUsedAt: [] },
        completions: {
          total: 0,
          byStatus: {
            pending: 0,
            confirmed: 0,
            finalized: 0,
            disputed: 0,
            voided: 0,
          },
        },
        photos: { stored: 0, items: [] },
        connectedApps: [],
        profile: {
          ...view().profile,
          telegramLinked: false,
          kioskPinSet: false,
        },
      }),
    );
    expect(html).toContain("none; two-factor off");
    expect(html).toContain("Telegram not linked; kiosk PIN not set");
    expect(html).not.toContain("still open");
    expect(html).not.toContain("the next is deleted");
    expect(html).toMatch(/Proof photos<\/dt><dd>none</);
    expect(html).toMatch(/Connected apps<\/dt><dd>none</);
  });

  it("names one open claim's photo without a date to delete it", () => {
    const html = render(
      view({
        photos: { stored: 1, items: [{ attachedAt: USED, deletesAt: null }] },
      }),
    );
    expect(html).toContain(
      `1; 1 on a claim still open, deleted ${PHOTO_RETENTION_DAYS} days after settling`,
    );
  });
});
