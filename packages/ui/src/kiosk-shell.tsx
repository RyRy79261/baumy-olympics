import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import type { AvatarSprites } from "@baumy/types";
import { MemberCharacter } from "./member-character";

// The kitchen kiosk's frame in the pixel kit (SPEC §8; ADR 0005): a
// portrait screen (820×1180) that never scrolls as a page. The content
// fills it above the footer nav, and scrolls on its own if it must; Baumy
// sits in the corner over the footer's right end, and whatever covers the
// whole screen (the night screen, #66's reminder and screensaver) goes on
// top. Every touch target here is at least 56px, and nothing depends on
// hover.

export function KioskShell({
  skin = "day",
  footer,
  corner,
  children,
}: {
  /**
   * The time-of-day skin (SPEC §7, §8): "day" from 06:30 to 23:00, "night"
   * otherwise. The kit is dark all day (ADR 0005 §7), so it is only a hook
   * on `[data-skin]`; night itself is the Screensaver over everything.
   */
  skin?: "day" | "night";
  /** The footer nav (KioskFooter). */
  footer?: ReactNode;
  /** Baumy, over the footer's right end. */
  corner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-kiosk
      data-skin={skin}
      className="relative flex h-dvh touch-manipulation flex-col overflow-hidden bg-bm-bg text-bm-text select-none"
    >
      <div className="flex min-h-0 flex-1 flex-col pb-[84px]">{children}</div>
      {footer}
      {corner ? (
        <div className="absolute right-3.5 bottom-1 z-30">{corner}</div>
      ) : null}
    </div>
  );
}

/**
 * The bar over the kiosk's other pages: the avatars (tap to pick who is
 * acting) and a status slot. The dashboard home has none; its Baumy sheet
 * asks who is there instead.
 */
export function KioskTopBar({
  avatars,
  status,
}: {
  /** One AvatarButton per member. */
  avatars: ReactNode;
  /** Who is acting, and the way to stop. */
  status?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-4 border-b-2 border-bm-line bg-bm-chrome px-4 py-2">
      <nav
        aria-label="Who is here"
        className="flex flex-1 gap-2 overflow-x-auto"
      >
        {avatars}
      </nav>
      {status ? <div className="flex items-center gap-3">{status}</div> : null}
    </header>
  );
}

export interface AvatarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  displayName: string;
  /** Their colour (`members.color`): the frame when picked, the initial tile. */
  color: string;
  /** Their gallery sprite (issue #111); without one, their initial tile. */
  sprites?: AvatarSprites | null;
  /** Drawn instead of the character (the acting member's score emote). */
  character?: ReactNode;
  /** This member is the one acting now. */
  selected?: boolean;
}

/** A member's avatar in the kiosk bar: a 64px tap target. */
export function AvatarButton({
  displayName,
  color,
  selected = false,
  sprites,
  character,
  className,
  type = "button",
  ...props
}: AvatarButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        // Character over a one-line name, so four housemates fit the
        // portrait screen's 820px next to the brand and the status.
        "pixel-frame inline-flex min-h-16 min-w-16 max-w-32 shrink-0 flex-col items-center justify-center gap-1 px-2 py-1.5 font-label text-xs font-bold uppercase",
        selected ? "bg-bm-raised text-bm-text" : "text-bm-muted",
        className,
      )}
      style={selected ? { ["--pf" as string]: color } : undefined}
      {...props}
    >
      {character ?? (
        <MemberCharacter
          sprites={sprites}
          name={displayName}
          colour={color}
          scale={2}
        />
      )}
      <span className="max-w-full truncate whitespace-nowrap">
        {displayName}
      </span>
    </button>
  );
}
