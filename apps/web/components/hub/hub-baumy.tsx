"use client";

import { usePathname } from "next/navigation";
import { BaumySheet } from "@/components/baumy/baumy-sheet";

// The hub home's Baumy button (SPEC §3.1, issue #152). It is mounted in the
// hub frame's top bar so that below lg it sits there beside the menus,
// never floating over the page on a phone or a tablet; from lg up the same
// button is the bottom-right corner one. Only the home has Baumy, as before.

export function HubBaumy({ voice }: { voice: boolean }) {
  const pathname = usePathname();
  if (pathname !== "/") return null;
  return <BaumySheet voice={voice} docked />;
}
