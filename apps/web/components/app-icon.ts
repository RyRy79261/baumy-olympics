import { badgePng } from "@/lib/brand/badge-png";

// The app icon (issue #81): the Baumy badge (packages/ui
// pixel/baumy-badge.ts), the owner's pick, as a PNG drawn pixel for pixel
// from the sprite (lib/brand/badge-png.ts). app/icon.tsx, app/apple-icon.tsx
// and app/manifest.ts only ask for a size.

/** The theme colour the manifest and the status bar use. */
export const APP_BACKGROUND = "#140c1f";

/**
 * How much of a maskable icon the badge fills: the safe zone launchers
 * never crop is the circle 80% of the icon wide, and the badge is a circle.
 */
export const MASKABLE_ART = 0.8;

export type AppIconKind = "any" | "maskable" | "apple";

/** The badge's size and backdrop for each kind of icon. */
export function appIconOptions(
  size: number,
  kind: AppIconKind,
): { art: number; background?: string } {
  switch (kind) {
    // A launcher crops to its own shape, so the badge sits inside the safe
    // zone on the theme colour.
    case "maskable":
      return {
        art: Math.floor(size * MASKABLE_ART),
        background: APP_BACKGROUND,
      };
    // iOS wants no transparency and rounds the corners itself.
    case "apple":
      return { art: size, background: APP_BACKGROUND };
    // A browser tab and the "any" launcher icons: the round badge alone,
    // with clear corners.
    case "any":
      return { art: size };
  }
}

/** A square PNG `size` px wide, as the icon routes return it. */
export function renderAppIcon(
  size: number,
  kind: AppIconKind = "any",
): Response {
  return new Response(
    new Uint8Array(badgePng(size, appIconOptions(size, kind))),
    {
      headers: { "Content-Type": "image/png" },
    },
  );
}
