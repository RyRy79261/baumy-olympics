import type { ReactNode } from "react";
import { BaumyCat } from "./baumy-cat";

// The signed-out pages (sign in, sign up, reset, sign out; ADR 0005): Baumy
// sitting on top of one pixel-framed card in the middle of the dark screen.
// It is the page's <main>; the form inside starts with its PageHeading.

/** The classes an inline text link gets. */
export const linkClass =
  "text-bm-teal underline underline-offset-4 hover:text-bm-text";

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bm-bg px-4 py-10 text-bm-text">
      <div className="flex w-full max-w-md flex-col items-center">
        <BaumyCat scale={3} facing="right" />
        <p className="mt-2 mb-4 font-display text-xs text-bm-muted">
          Baumy Olympics
        </p>
        <div className="pixel-frame pixel-frame-4 w-full bg-bm-surface p-6 text-lg sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
