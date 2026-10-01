// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { useTestDb } from "@baumy/db/test-harness";
import { MEMBER_COLORS } from "@baumy/types";
import { seedMember } from "@/test-utils/actions";
import { activeRoster } from "./characters";
import { householdMembers, householdRoster } from "./household";

// The request's shared members read (issue #128): the same members and
// looks as the reads it replaces on the layouts and pages.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

describe("householdMembers and householdRoster", () => {
  it("are the active members in join order, and their looks", async () => {
    const ryan = await seedMember(db(), {
      displayName: "Ryan",
      color: MEMBER_COLORS[0],
    });
    const jo = await seedMember(db(), {
      displayName: "Jo",
      color: MEMBER_COLORS[1],
    });
    const gone = await seedMember(db(), {
      displayName: "Gone",
      deactivatedAt: new Date(),
    });

    const people = await householdMembers(HOUSEHOLD_ID);
    expect(people.map((p) => p.id)).toEqual([ryan, jo]);
    expect(people.map((p) => p.id)).not.toContain(gone);

    const roster = await householdRoster(HOUSEHOLD_ID);
    expect(roster.get(jo)).toEqual({
      name: "Jo",
      colour: MEMBER_COLORS[1],
      sprites: null,
    });
    expect(roster).toEqual(await activeRoster(db(), HOUSEHOLD_ID));
  });
});
