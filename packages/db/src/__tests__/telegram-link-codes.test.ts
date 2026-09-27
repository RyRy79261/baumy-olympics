import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { members, telegramLinkCodes } from "../schema";
import {
  TELEGRAM_LINK_CODE_TTL_MS,
  claimTelegramLinkCode,
  hashTelegramLinkCode,
  insertTelegramLinkCode,
} from "../telegram-link-codes";
import { useTestDb } from "./_harness";

const t = useTestDb();
const NOW = new Date("2026-09-27T10:00:00Z");

describe("hashTelegramLinkCode", () => {
  it("is a sha256 hex that ignores case and surrounding space", () => {
    const h = hashTelegramLinkCode("ab12cd34");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTelegramLinkCode(" AB12CD34 ")).toBe(h);
    expect(hashTelegramLinkCode("AB12CD35")).not.toBe(h);
  });
});

describe("insertTelegramLinkCode", () => {
  it("stores only the hash, expiring 10 minutes from now", async () => {
    const [m] = await t
      .db()
      .insert(members)
      .values({
        householdId: HOUSEHOLD_ID,
        displayName: "Ryan",
        avatarSprite: "cat",
        color: "#112233",
      })
      .returning({ id: members.id });
    const { expiresAt } = await insertTelegramLinkCode(
      t.db() as unknown as Queryable,
      { code: "AB12CD34", memberId: m!.id, now: NOW },
    );
    expect(expiresAt.getTime() - NOW.getTime()).toBe(TELEGRAM_LINK_CODE_TTL_MS);
    const rows = await t.db().select().from(telegramLinkCodes);
    expect(rows).toEqual([
      {
        codeHash: hashTelegramLinkCode("AB12CD34"),
        memberId: m!.id,
        expiresAt,
        usedAt: null,
        usedByTg: null,
        createdAt: NOW,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("AB12CD34");
  });
});

describe("claimTelegramLinkCode", () => {
  const db = () => t.db() as unknown as Queryable;
  const TG = 5_000_000_002;

  async function member() {
    const [m] = await t
      .db()
      .insert(members)
      .values({
        householdId: HOUSEHOLD_ID,
        displayName: "Ryan",
        avatarSprite: "cat",
        color: "#112233",
      })
      .returning({ id: members.id });
    return m!.id;
  }

  it("claims a live code once, whatever its case, and records the tg id", async () => {
    const memberId = await member();
    await insertTelegramLinkCode(db(), {
      code: "AB12CD34",
      memberId,
      now: NOW,
    });
    const at = new Date(NOW.getTime() + 60_000);
    await expect(
      claimTelegramLinkCode(db(), {
        code: " ab12cd34 ",
        telegramUserId: TG,
        now: at,
      }),
    ).resolves.toEqual({ memberId });
    const [row] = await t.db().select().from(telegramLinkCodes);
    expect(row).toMatchObject({ usedAt: at, usedByTg: TG });
    // Used: a second claim finds nothing.
    await expect(
      claimTelegramLinkCode(db(), {
        code: "AB12CD34",
        telegramUserId: TG,
        now: at,
      }),
    ).resolves.toBeNull();
  });

  it("refuses an expired code and a wrong one", async () => {
    const memberId = await member();
    const { expiresAt } = await insertTelegramLinkCode(db(), {
      code: "EF56GH78",
      memberId,
      now: NOW,
    });
    await expect(
      claimTelegramLinkCode(db(), {
        code: "EF56GH79",
        telegramUserId: TG,
        now: NOW,
      }),
    ).resolves.toBeNull();
    await expect(
      claimTelegramLinkCode(db(), {
        code: "EF56GH78",
        telegramUserId: TG,
        now: expiresAt,
      }),
    ).resolves.toBeNull();
    const [row] = await t.db().select().from(telegramLinkCodes);
    expect(row).toMatchObject({ usedAt: null, usedByTg: null });
  });
});
