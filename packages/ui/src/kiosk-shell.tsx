import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Sprite } from "./sprite";

// NEUTRAL PLACEHOLDER for the kitchen kiosk's frame (SPEC §8; issue #7
// restyles it). A landscape screen that never scrolls as a page: a top bar
// with the brand, the avatar bar (tap to pick who is acting) and a status
// slot, then the content, which scrolls on its own if it must. Every touch
// target here is at least 56px, and nothing depends on hover.

export function KioskShell({
  brand,
  avatars,
  status,
  children,
}: {
  brand: ReactNode;
  /** One AvatarButton per member. */
  avatars: ReactNode;
  /** Who is acting, and the way to stop. */
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-kiosk
      className="flex h-dvh touch-manipulation flex-col overflow-hidden bg-neutral-100 text-neutral-900 select-none"
    >
      <header className="flex items-center gap-4 border-b border-neutral-300 bg-white px-4 py-2">
        <div className="text-xl font-bold">{brand}</div>
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
  /** This member is the one acting now. */
  selected?: boolean;
}

/** A member's avatar in the kiosk bar: a 64px tap target. */
export function AvatarButton({
  displayName,
  sprite,
  color,
  selected = false,
  className,
  type = "button",
  ...props
}: AvatarButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        "inline-flex min-h-16 min-w-16 shrink-0 items-center gap-2 rounded border px-3 text-base font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900",
        selected
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-400 bg-white text-neutral-900",
        className,
      )}
      {...props}
    >
      <Sprite name={sprite} color={color} size={2} />
      <span>{displayName}</span>
    </button>
  );
}
