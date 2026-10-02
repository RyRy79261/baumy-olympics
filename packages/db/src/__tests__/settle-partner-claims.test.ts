import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rescoreUnscoredClaims } from "../completions";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import * as schema from "../schema";
import { ensureSeason } from "../seasons";
import { seedPlayer } from "./_game-fixtures";

// The data migration that retires the partner confirm mode (issue #150, SPEC
// §12 decision 29), on PGlite: the database is migrated up to the one before
// it, given partner-mode history, and then migrated by hand, twice, to show
// it is idempotent. Then the deploy's `db:seed` hook (`rescoreUnscoredClaims`)
// scores the claims the migration made count, once. The column itself stays
// for now (deprecated), so the deploy still live while this one builds keeps
// working.

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));
const journal = JSON.parse(
  readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8"),
) as { entries: { idx: number; tag: string }[] };

const tagOf = (idx: number) => journal.entries.find((e) => e.idx === idx)!.tag;
const SETTLE = tagOf(24);
const sqlOf = (tag: string) => readFileSync(`${MIGRATIONS}/${tag}.sql`, "utf8");

const HOUR = 60 * 60_000;

let client: PGlite;
let db: Queryable;

beforeAll(async () => {
  expect(SETTLE).toBe("0024_settle_partner_claims");
  client = new PGlite();
  for (const e of journal.entries.filter((e) => e.idx < 24)) {
    await client.exec(sqlOf(e.tag));
  }
  db = drizzle(client, { schema }) as unknown as Queryable;
}, 60_000);

afterAll(async () => {
  await client?.close();
});

interface Row {
  label: string;
  status: string;
  void_reason: string | null;
  finalizes_at: Date | null;
}

async function rows(): Promise<Row[]> {
  const r = await client.query<Row>(
    `select note as label, status, void_reason, finalizes_at
       from completions order by note`,
  );
  return r.rows;
}

describe("0024_settle_partner_claims", () => {
  it("settles partner-mode claims, idempotently, and the column then goes", async () => {
    // The migration reads the database's clock, so the history is laid out
    // around the real time.
    const now = Date.now();
    const ago = (h: number) => new Date(now - h * HOUR);
    const ryan = await seedPlayer(db, "Ryan");
    const sam = await seedPlayer(db, "Sam");
    const season = await ensureSeason(db, {
      householdId: HOUSEHOLD_ID,
      year: new Date(now).getUTCFullYear(),
      now: new Date(now),
    });
    const chore = async (name: string, mode: "optimistic" | "partner") => {
      const r = await client.query<{ id: string }>(
        `insert into chores (household_id, name, sprite, confirm_mode)
         values ($1, $2, $3, $4) returning id`,
        [HOUSEHOLD_ID, name, name.toLowerCase(), mode],
      );
      const id = r.rows[0]!.id;
      await client.query(
        `insert into chore_rule_versions
           (chore_id, effective_from, base_points, cooldown_minutes, source)
         values ($1, '2020-01-01T00:00:00Z', 10, 0, 'seed')`,
        [id],
      );
      return id;
    };
    const partner = await chore("Mop", "partner");
    const optimistic = await chore("Trash", "optimistic");

    let seq = 0;
    const claim = async (
      label: string,
      choreId: string,
      fields: Partial<typeof schema.completions.$inferInsert> & {
        loggedAt: Date;
      },
    ) => {
      seq += 1;
      await db.insert(schema.completions).values({
        householdId: HOUSEHOLD_ID,
        choreId,
        seasonId: season.id,
        doneBy: ryan,
        loggedBy: ryan,
        occurredAt: fields.loggedAt,
        source: "ui",
        status: "pending",
        clientRequestId: `migration-${seq}`,
        note: label,
        ...fields,
      });
    };
    // Partner mode, nobody confirmed it within 72h.
    await claim("a-expired", partner, { loggedAt: ago(80) });
    // Partner mode, still waiting.
    await claim("b-waiting", partner, { loggedAt: ago(2) });
    // Partner mode, disputed.
    await claim("c-disputed", partner, {
      loggedAt: ago(3),
      status: "disputed",
    });
    // Logged by Sam for Ryan: verified at once, never had a window.
    await claim("d-for-ryan", partner, {
      loggedAt: ago(5),
      loggedBy: sam,
      status: "confirmed",
      verifiedBy: sam,
      verifiedAt: ago(5),
    });
    // Undone long ago.
    await claim("e-undone", partner, {
      loggedAt: ago(100),
      status: "voided",
      voidReason: "undone",
    });
    // An ordinary claim, already with its window.
    await claim("f-optimistic", optimistic, {
      loggedAt: ago(1),
      finalizesAt: new Date(now - HOUR + 24 * HOUR),
    });
    // Left behind by a chore switched away from partner mode.
    await claim("g-left-behind", optimistic, { loggedAt: ago(30) });

    const windowOf = (h: number) => new Date(now - h * HOUR + 24 * HOUR);
    const expected: Row[] = [
      {
        label: "a-expired",
        status: "voided",
        void_reason: "unconfirmed",
        finalizes_at: null,
      },
      {
        label: "b-waiting",
        status: "pending",
        void_reason: null,
        finalizes_at: windowOf(2),
      },
      {
        label: "c-disputed",
        status: "disputed",
        void_reason: null,
        finalizes_at: windowOf(3),
      },
      {
        label: "d-for-ryan",
        status: "confirmed",
        void_reason: null,
        finalizes_at: null,
      },
      {
        label: "e-undone",
        status: "voided",
        void_reason: "undone",
        finalizes_at: null,
      },
      {
        label: "f-optimistic",
        status: "pending",
        void_reason: null,
        finalizes_at: windowOf(1),
      },
      {
        label: "g-left-behind",
        status: "pending",
        void_reason: null,
        finalizes_at: windowOf(30),
      },
    ];
    const modes = async () =>
      (
        await client.query<{ name: string; confirm_mode: string }>(
          "select name, confirm_mode from chores order by name",
        )
      ).rows;
    expect(await modes()).toEqual([
      { name: "Mop", confirm_mode: "partner" },
      { name: "Trash", confirm_mode: "optimistic" },
    ]);

    await client.exec(sqlOf(SETTLE));
    expect(await rows()).toEqual(expected);
    expect(await modes()).toEqual([
      { name: "Mop", confirm_mode: "optimistic" },
      { name: "Trash", confirm_mode: "optimistic" },
    ]);

    // A second run changes nothing.
    await client.exec(sqlOf(SETTLE));
    expect(await rows()).toEqual(expected);

    // The claims that now count have no score yet: SQL cannot replay them.
    const scored = async () =>
      (
        await client.query<{ label: string; total_pts: number }>(
          `select c.note as label, s.total_pts from completions c
             join completion_scores s on s.completion_id = c.id
            order by c.note`,
        )
      ).rows.map((r) => r.label);
    expect(await scored()).toEqual([]);

    // The deploy's seed hook scores every counted claim, once.
    const hook = () =>
      rescoreUnscoredClaims(db, {
        householdId: HOUSEHOLD_ID,
        now: new Date(now),
      });
    await expect(hook()).resolves.toBe(2);
    expect(await scored()).toEqual([
      "b-waiting",
      "d-for-ryan",
      "f-optimistic",
      "g-left-behind",
    ]);
    // A second deploy finds nothing to do.
    await expect(hook()).resolves.toBe(0);
    expect(await rows()).toEqual(expected);
  });
});
