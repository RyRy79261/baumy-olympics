import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Housemate } from "./housemate";
import { Sprite } from "./sprite";

// The kitchen kiosk's frame in the pixel kit (SPEC §8; ADR 0005). A landscape screen that never scrolls as a page: a top bar
// with the brand, the avatar bar (tap to pick who is acting) and a status
// slot, then the content, which scrolls on its own if it must. Every touch
// target here is at least 56px, and nothing depends on hover.

export function KioskShell({
  brand,
  avatars,
  status,
  skin = "day",
  children,
}: {
  brand: ReactNode;
  /** One AvatarButton per member. */
  avatars: ReactNode;
  /** Who is acting, and the way to stop. */
  status?: ReactNode;
  /**
   * The time-of-day skin (SPEC §7, §8): "day" from 06:30 to 23:00, "night"
   * otherwise. The kit is dark all day (ADR 0005 §7), so it is only a hook
   * on `[data-skin]`; night itself is the NightScreen over everything.
   */
  skin?: "day" | "night";
  children: ReactNode;
}) {
  return (
    <div
      data-kiosk
      data-skin={skin}
      className="flex h-dvh touch-manipulation flex-col overflow-hidden bg-bm-bg text-bm-text select-none"
    >
      <header className="flex items-center gap-4 border-b-2 border-bm-line bg-[#0f0918] px-4 py-2">
        <div className="font-display text-lg">{brand}</div>
        <nav
          aria-label="Who is here"
          className="flex flex-1 gap-2 overflow-x-auto"
        >
          {avatars}
        </nav>
        {status ? (
          <div className="flex items-center gap-3">{status}</div>
        ) : null}
      </header>
      <main className="flex-1 overflow-auto p-4">{children}</main>
    </div>
  );
}

export interface AvatarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  displayName: string;
  /** What `members.avatar_sprite` stores. */
  sprite: string;
  color: string;
  /**
   * The member's 16-bit character (`members.avatar`) and id; given the id,
   * the button shows their Housemate (their default one without a choice)
   * instead of the sprite tile.
   */
  avatar?: unknown;
  memberId?: string;
  /** This member is the one acting now. */
  selected?: boolean;
}

/** A member's avatar in the kiosk bar: a 64px tap target. */
export function AvatarButton({
  displayName,
  sprite,
  color,
  selected = false,
  avatar,
  memberId,
  className,
  type = "button",
  ...props
}: AvatarButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        "pixel-frame inline-flex min-h-16 min-w-16 shrink-0 items-center gap-2 px-3 font-label text-base font-bold uppercase",
        selected ? "bg-bm-raised text-bm-text" : "text-bm-muted",
        className,
      )}
      style={selected ? { ["--pf" as string]: color } : undefined}
      {...props}
    >
      {memberId ? (
        <Housemate avatar={avatar} memberId={memberId} scale={3} />
      ) : (
        <Sprite name={sprite} color={color} size={2} />
      )}
      <span>{displayName}</span>
    </button>
  );
}
