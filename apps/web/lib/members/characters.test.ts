// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { insertAvatar } from "@baumy/db/avatars";
import { members } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { MEMBER_COLORS } from "@baumy/types";
import { seedMember } from "@/test-utils/actions";
import { photoProxyUrl } from "@/lib/photos/paths";
import { activeRoster, rosterColours } from "./characters";

// One source for every member's look and colour (issues #65, #116): the
// active members' roster, so a member is the same colour on the dashboard,
// the reminder, the hub and the calendar.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

describe("activeRoster", () => {
  it("is the active members, in their own colour, with the gallery sprite of those who picked one", async () => {
    const ryan = await seedMember(db(), {
      displayName: "Ryan",
      color: MEMBER_COLORS[0],
    });
    const jo = await seedMember(db(), {
      displayName: "Jo",
      color: MEMBER_COLORS[1],
    });
    await seedMember(db(), { displayName: "Gone", deactivatedAt: new Date() });
    const id = randomUUID();
    const pathname = `avatars/${id}/a1b2c3d4e5f60718.png`;
    await insertAvatar(db(), {
      id,
      householdId: HOUSEHOLD_ID,
      name: "Knight",
      createdBy: ryan,
      createdAt: new Date(),
      poses: { idle: { pathname, width: 28, height: 56 } },
    });
    await t
      .db()
      .update(members)
      .set({ avatarImageId: id })
      .where(eq(members.id, jo));

    const roster = await activeRoster(db(), HOUSEHOLD_ID);
    expect([...roster.keys()].sort()).toEqual([ryan, jo].sort());
    expect(roster.get(jo)).toEqual({
      name: "Jo",
      colour: MEMBER_COLORS[1],
      sprites: {
        idle: { src: photoProxyUrl(pathname), width: 28, height: 56 },
        walk: null,
        emote: null,
      },
    });
    // No gallery character: MemberCharacter shows the initial tile.
    expect(roster.get(ryan)).toEqual({
      name: "Ryan",
      colour: MEMBER_COLORS[0],
      sprites: null,
    });
  });
});

describe("rosterColours", () => {
  it("is each member's own colour", () => {
    expect(
      rosterColours([
        { id: "a", color: MEMBER_COLORS[2] },
        { id: "b", color: MEMBER_COLORS[3] },
      ]),
    ).toEqual({ a: MEMBER_COLORS[2], b: MEMBER_COLORS[3] });
  });
});
