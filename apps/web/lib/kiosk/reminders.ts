import type { AvatarSprites } from "@baumy/types";
import type { ListRemindersData, ReminderView } from "@/lib/actions/reminders";
import { isTestMode } from "@/lib/test-mode";

// What the kitchen screen's full-screen reminder draws (ADR 0005 §4, issue
// #66), from `list_reminders`. Pure and client-safe: the reminder overlay
// (components/kiosk/reminders.tsx) keeps its copy up to date with these
// after each tap, between polls.

/**
 * The cookie an e2e spec sets (`baumy_e2e_reminders=on`) to see reminders
 * on its own kiosk.
 */
export const REMINDERS_TEST_COOKIE = "baumy_e2e_reminders";

/**
 * Whether this kiosk shows the full-screen reminder. Always, except under
 * E2E_TEST_MODE=1, where the household is shared by every spec running in
 * parallel: there only a browser whose `baumy_e2e_reminders` cookie is "on"
 * does, so one spec's reminder never covers another spec's kiosk.
 */
export function kioskShowsReminders(
  testCookie: string | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !isTestMode(env) || testCookie === "on";
}

/**
 * A housemate on the reminder screen (packages/ui ReminderFace). No colour:
 * the screen colours each face by their character's shirt.
 */
export interface ReminderFaceView {
  id: string;
  displayName: string;
  avatar: unknown;
  /** Their gallery sprite, or null for the drawn character. */
  sprites: AvatarSprites | null;
  seen: boolean;
}

/**
 * The faces for `reminder`: every active member who must see it or has
 * (someone who joined after it was posted is not asked), in the order they
 * joined.
 */
export function reminderFaces(
  data: ListRemindersData,
  reminder: ReminderView,
): ReminderFaceView[] {
  const seen = new Set(reminder.seenBy);
  const asked = new Set([...reminder.seenBy, ...reminder.waitingFor]);
  return data.members
    .filter((m) => asked.has(m.id))
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      avatar: m.avatar,
      sprites: m.sprites,
      seen: seen.has(m.id),
    }));
}

/** `memberId` has seen `reminderId`. */
export function markSeen(
  data: ListRemindersData,
  reminderId: string,
  memberId: string,
): ListRemindersData {
  return {
    ...data,
    reminders: data.reminders.map((r) =>
      r.id !== reminderId || r.seenBy.includes(memberId)
        ? r
        : {
            ...r,
            seenBy: [...r.seenBy, memberId],
            waitingFor: r.waitingFor.filter((id) => id !== memberId),
          },
    ),
  };
}

/** The list without `reminderId` (seen by everyone, or dismissed). */
export function withoutReminder(
  data: ListRemindersData,
  reminderId: string,
): ListRemindersData {
  return {
    ...data,
    reminders: data.reminders.filter((r) => r.id !== reminderId),
  };
}
