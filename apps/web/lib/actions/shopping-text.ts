// Client-safe words for the shopping actions (issue #26): shared by their
// previews and the UI's toasts.

/** "milk", "milk and eggs", "milk, eggs and bread". */
export function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
