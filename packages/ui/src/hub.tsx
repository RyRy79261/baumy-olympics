import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Sprite, type SpriteState } from "./sprite";

// NEUTRAL PLACEHOLDERS for the hub (SPEC §3.1; issue #7 restyles them here):
// the widget frame, the grid the widgets sit in, the clock face and the Baumy
// button. On the kiosk the grid fills the screen and never scrolls: each
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
        "flex min-h-0 flex-col gap-2 overflow-hidden rounded border border-neutral-300 bg-white p-3",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold text-neutral-900">
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
              "text-sm",
              status === "unavailable" ? "text-red-800" : "text-neutral-600",
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
          ? "grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-3"
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
          "font-mono font-semibold tabular-nums text-neutral-900",
          kiosk ? "text-5xl" : "text-4xl",
        )}
      >
        {time}
      </span>
      <span data-testid="clock-date" className="text-sm text-neutral-700">
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
      className={cx("flex flex-col divide-y divide-neutral-200", className)}
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
        <span className="truncate text-sm font-medium text-neutral-900">
          {primary}
        </span>
        {secondary ? (
          <span className="truncate text-xs text-neutral-600">{secondary}</span>
        ) : null}
      </div>
      {trailing ? (
        <span className="shrink-0 text-sm text-neutral-900">{trailing}</span>
      ) : null}
    </li>
  );
}

/**
 * The Baumy button (SPEC §3.1, §3.6): bottom right, over everything, the way
 * into the command sheet. A placeholder sprite until issue #7 draws Baumy;
 * `state` is the animation it will play.
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
        "fixed right-4 bottom-4 z-10 inline-flex min-h-16 min-w-16 items-center justify-center rounded-full border border-neutral-900 bg-white shadow",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900",
        className,
      )}
      {...props}
    >
      <Sprite name="baumy" state={state} size={3} color="#171717" />
    </button>
  );
}
