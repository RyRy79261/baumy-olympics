// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { members } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { rosterAvatars } from "@baumy/types";
import { SHIRT_COLOURS } from "@baumy/ui";
import { seedMember } from "@/test-utils/actions";
import { activeCharacters, rosterColours } from "./characters";

// One source for every member's character and colour (issue #65): the
// active members' roster, so a member is the same colour on the dashboard,
// the reminder, the hub and the calendar.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

describe("activeCharacters", () => {
  it("is the roster of the active members, chosen characters kept", async () => {
    const chosen = {
      hairStyle: "spiky",
      hairColor: "auburn",
      skinTone: "tan",
      shirtColor: "violet",
    } as const;
    const ids = [];
    for (const name of ["Ryan", "Jo", "Sam", "Mika"]) {
      ids.push(await seedMember(db(), { displayName: name }));
    }
    await t
      .db()
      .update(members)
      .set({ avatar: chosen })
      .where(eq(members.id, ids[1]!));
    await seedMember(db(), { displayName: "Gone", deactivatedAt: new Date() });

    const characters = await activeCharacters(db(), HOUSEHOLD_ID);
    expect([...characters.keys()].sort()).toEqual([...ids].sort());
    expect(characters.get(ids[1]!)).toEqual(chosen);
    const shirts = [...characters.values()].map((a) => a.shirtColor);
    expect(new Set(shirts).size).toBe(4);
  });
});

describe("rosterColours", () => {
  it("is each member's shirt colour", () => {
    const roster = rosterAvatars([
      { id: "a", avatar: null },
      { id: "b", avatar: null },
    ]);
    const colours = rosterColours(roster);
    expect(colours).toEqual({
      a: SHIRT_COLOURS[roster.get("a")!.shirtColor],
      b: SHIRT_COLOURS[roster.get("b")!.shirtColor],
    });
    expect(colours.a).not.toBe(colours.b);
  });
});
