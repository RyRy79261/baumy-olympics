"use client";

import { usePathname } from "next/navigation";
import { BaumyButton } from "@baumy/ui";
import { useBarRelay } from "@/components/baumy/bar-relay";

// The hub home's Baumy in the top bar (SPEC §3.1, issue #152): below 89rem
// (1424px, the first width whose side margin clears the corner button) it
// sits beside the menus, so on a phone or a tablet it never floats over the
// page, and it opens the one sheet, which with the corner button sits at
// the end of the home (HubHome). From 89rem up the corner button shows
// instead.
// Only the home has Baumy, as before.

export function HubBaumy() {
  const pathname = usePathname();
  const { mood, wake } = useBarRelay();
  if (pathname !== "/") return null;
  return (
    <BaumyButton
      bar
      state={mood}
      onClick={() => wake?.()}
      className="min-[89rem]:hidden"
    />
  );
}
