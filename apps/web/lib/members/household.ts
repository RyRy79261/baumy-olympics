import "server-only";

import { cache } from "react";
import { createHttpDb, type Queryable } from "@baumy/db";
import { listActiveMembers } from "@baumy/db/members";
import { rosterFrom } from "./characters";

// The household's active members for one request (issue #128). A layout and
// its page both show them (the hub's header and its page; the kiosk's avatar
// bar and its page), so they share one read: `cache()` scopes it to the
// request, like `getActor`, and React forgets it when the request ends.

/** The active members, in join order, read once per request. */
export const householdMembers = cache((householdId: string) =>
  listActiveMembers(createHttpDb() as unknown as Queryable, householdId),
);

/** Their looks, by id (`activeRoster`), from the same read. */
export async function householdRoster(householdId: string) {
  return rosterFrom(await householdMembers(householdId));
}
