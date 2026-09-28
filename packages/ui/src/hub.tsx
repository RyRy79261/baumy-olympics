import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Sprite, type SpriteState } from "./sprite";

// The hub in the pixel kit (SPEC §3.1; ADR 0005): the widget frame, the grid
// the widgets sit in, the clock face and the Baumy button. On the kiosk the grid fills the screen and never scrolls: each
// widget clips what does not fit, so the page stays one screen at 1180×820.

/** What a widget has to show. */
export type WidgetStatus = "ready" | "empty" | "unavailable";

export function Widget({
  title,
  status,
  message,
  action,
  footer,
  children,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: string;
  /** `ready` shows the children; the others show `message` instead. */
  status: WidgetStatus;
  /** The sentence for `empty` and `unavailable`. */
  message?: string;
  /** A link or button in the corner ("All notes"). */
  action?: ReactNode;
  /** A line under the content, shown whatever the status (the pot total). */
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const headingId = props.id ? `${props.id}-title` : undefined;
  return (
    <section
      aria-labelledby={headingId}
      aria-label={headingId ? undefined : title}
      data-status={status}
      className={cx(
        "pixel-frame pixel-frame-4 flex min-h-0 flex-col gap-2 overflow-hidden bg-bm-surface p-4 text-bm-text",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={headingId}
          className="font-display text-sm leading-relaxed text-bm-text"
        >
          {title}
        </h2>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {status === "ready" ? (
          children
        ) : (
          <p
            role={status === "unavailable" ? "alert" : undefined}
            className={cx(
              "text-lg",
              status === "unavailable" ? "text-bm-red" : "text-bm-muted",
            )}
          >
            {message}
          </p>
        )}
      </div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </section>
  );
}

/**
 * The widgets' grid. `kiosk` fills the space it is given (three columns, two
 * rows) and never grows past it; otherwise it stacks on a phone and makes
 * columns on wider screens.
 */
export function HubGrid({
  kiosk = false,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { kiosk?: boolean }) {
  return (
    <div
      className={cx(
        kiosk
          ? "grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-3 pb-32"
          : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** The big time and the date under it, as the page formats them. */
export function ClockFace({
  time,
  date,
  kiosk = false,
}: {
  /** "14:05". */
  time: string;
  /** "Sunday 27 September". */
  date: string;
  kiosk?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span
        data-testid="clock-time"
        className={cx(
          "font-display leading-none text-bm-text",
          kiosk ? "text-5xl" : "text-4xl",
        )}
      >
        {time}
      </span>
      <span
        data-testid="clock-date"
        className="mt-3 font-label text-lg font-bold tracking-wider text-bm-muted uppercase"
      >
        {date}
      </span>
    </div>
  );
}

/** A plain list inside a widget: one row per item. */
export function WidgetList({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className={cx("flex flex-col divide-y-2 divide-bm-line", className)}
      {...props}
    >
      {children}
    </ul>
  );
}

export function WidgetItem({
  primary,
  secondary,
  trailing,
  ...props
}: Omit<HTMLAttributes<HTMLLIElement>, "children"> & {
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5" {...props}>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-lg leading-tight text-bm-text">
          {primary}
        </span>
        {secondary ? (
          <span className="truncate font-label text-xs text-bm-muted uppercase">
            {secondary}
          </span>
        ) : null}
      </div>
      {trailing ? (
        <span className="shrink-0 text-lg text-bm-text">{trailing}</span>
      ) : null}
    </li>
  );
}

/**
 * The Baumy button (SPEC §3.1, §3.6; ADR 0005 §1): the cat itself, bottom
 * right, over everything, the way into the command sheet. `state` is its
 * mood (lib/ai/mood.ts).
 */
export function BaumyButton({
  state = "idle",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { state?: SpriteState }) {
  return (
    <button
      type={type}
      aria-label="Ask Baumy"
      className={cx(
        // Baumy sits on a small raised plinth in the corner (the prototype's
        // footer end), so it reads against any page; the shells keep that
        // corner clear (AppShell's bottom padding, HubGrid's on the kiosk).
        "fixed right-3 bottom-3 z-10 inline-flex touch-manipulation items-end justify-center",
        "pixel-frame pixel-frame-4 bg-bm-raised px-3 pt-2 pb-3 [--pf:var(--color-bm-violet)]",
        "shadow-[0_6px_0_rgb(0_0_0/0.45)] active:translate-y-px",
        className,
      )}
      {...props}
    >
      <Sprite name="baumy" state={state} size={6} />
    </button>
  );
}
