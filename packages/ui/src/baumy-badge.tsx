import { cx } from "./cx";
import { BADGE_GRID, BADGE_PALETTE } from "./pixel/baumy-badge";
import { PixelArt } from "./pixel/pixel-art";

// The brand mark (issue #81): the Baumy badge, the same grid as the app icon
// (pixel/baumy-badge.ts). It stands still; the animated cat is BaumyCat.

export function BaumyBadge({
  scale = 1,
  label,
  className,
}: {
  /** Screen pixels per art pixel (the badge is 40 art pixels wide). */
  scale?: number;
  /** Decorative unless labelled. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      data-sprite="baumy-badge"
      className={cx("inline-block shrink-0 leading-none", className)}
    >
      <PixelArt
        grid={BADGE_GRID}
        palette={BADGE_PALETTE}
        scale={scale}
        label={label}
        className="block"
      />
    </span>
  );
}
