import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { choreGlyph } from "./chores";
import { cx } from "./cx";
import { Glyph, PixelIcon } from "./pixel/glyph";
import type { PixelIconName } from "./pixel/icons";

// Chores presented as bounties (ADR 0005 §2), in the approved prototype's
// calm rows (proto/kiosk-home-pixel, calm-kit.tsx `BountyRows`): the kind's
// glyph in its colour, the name with its New mark, the kind and the streak,
// then when it is due (red when urgent: that is the one urgent signal) and
// its points. Also the filter tabs above
// a list and the status tiles (Urgent, New, Messages) of the hub's top row.
// One accent, one meaning (ADR 0005 §8): amber is consumable, teal is
// maintenance, red is urgent, yellow is new or points, pink is messages.

export type BountyKind = "consumable" | "maintenance";

/** "Consumable" or "Maintenance", as a bounty's second line says it. */
export const BOUNTY_KIND_LABEL: Readonly<Record<BountyKind, string>> = {
  consumable: "Consumable",
  maintenance: "Maintenance",
};

const KIND_TEXT: Record<BountyKind, string> = {
  consumable: "text-bm-amber",
  maintenance: "text-bm-teal",
};

const KIND_BOX: Record<BountyKind, string> = {
  consumable: "bg-bm-amber/10 text-bm-amber [--pf:rgb(255_179_71/0.35)]",
  maintenance: "bg-bm-teal/10 text-bm-teal [--pf:rgb(79_245_230/0.35)]",
};

/**
 * A bounty's glyph in a small frame in its kind's colour; `small` is the
 * admin list's.
 */
export function BountyGlyph({
  sprite,
  kind,
  size = "default",
}: {
  sprite: string;
  kind: BountyKind;
  size?: "small" | "default" | "kiosk";
}) {
  return (
    <span
      data-sprite={sprite}
      className={cx(
        "pixel-frame grid shrink-0 place-items-center",
        KIND_BOX[kind],
        size === "kiosk"
          ? "size-16"
          : size === "small"
            ? "size-10"
            : "size-12 sm:size-14",
      )}
    >
      <Glyph
        name={choreGlyph(sprite)}
        size={size === "kiosk" ? 40 : size === "small" ? 24 : 32}
        accent="var(--color-bm-text)"
      />
    </span>
  );
}

/** What a bounty shows, whether it is a button or a line in a widget. */
export interface BountyFields {
  name: string;
  /** What `chores.sprite` stores. */
  sprite: string;
  kind: BountyKind;
  /** Base points, or null while the chore has none. */
  points: number | null;
  /** E.g. "Ryan · streak 3", or "No streak yet". */
  streak: ReactNode;
  /** E.g. "Due since Wed 30 Sep, 08:00", or "Again from …". */
  status: ReactNode;
  /**
   * Due now or before Berlin midnight: the status line reads red, the one
   * urgent signal (no separate mark, ADR 0005 §8).
   */
  urgent?: boolean;
  /** Added in the last 3 days. */
  isNew?: boolean;
}

/** The glyph, the lines and the points of one bounty. */
function BountyFace({
  name,
  sprite,
  kind,
  points,
  streak,
  status,
  urgent = false,
  isNew = false,
  kiosk,
}: BountyFields & { kiosk: boolean }) {
  return (
    <>
      <BountyGlyph
        sprite={sprite}
        kind={kind}
        size={kiosk ? "kiosk" : "default"}
      />
      <span className="flex w-0 min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            data-bounty-name
            className={cx(
              "min-w-0 leading-tight font-semibold [overflow-wrap:anywhere]",
              kiosk ? "text-3xl" : "text-xl sm:text-2xl",
            )}
          >
            {name}
          </span>
          {isNew ? (
            <span className="font-label text-xs font-bold text-bm-yellow uppercase">
              New
            </span>
          ) : null}
        </span>
        {/* Two phrases that each stay whole: on a phone the streak drops to
            its own line rather than breaking mid-phrase. */}
        <span className="flex min-w-0 flex-wrap gap-x-2 font-label text-xs uppercase sm:flex-nowrap sm:text-sm">
          <span className={cx("whitespace-nowrap", KIND_TEXT[kind])}>
            {BOUNTY_KIND_LABEL[kind]}
          </span>
          <span className="max-w-full min-w-0 truncate text-bm-muted">
            <span className="text-bm-dim max-sm:hidden">· </span>
            {streak}
          </span>
        </span>
        <span
          data-bounty-status
          className={cx(
            "leading-snug",
            kiosk ? "text-lg" : "text-base",
            urgent ? "text-bm-red" : "text-bm-dim",
          )}
        >
          {status}
        </span>
      </span>
      {points !== null ? (
        <span
          data-bounty-points
          className={cx(
            "shrink-0 font-display text-bm-yellow",
            kiosk ? "text-base" : "text-xs sm:text-sm",
          )}
        >
          {points} pts
        </span>
      ) : null}
    </>
  );
}

export interface BountyRowProps
  extends
    BountyFields,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof BountyFields> {
  /** What the button at the end says ("Log it"); only for the eye. */
  cta?: string;
  /** 56px targets and larger text on the kiosk. */
  kiosk?: boolean;
}

/** One bounty in a list: the whole row is the button that opens it. */
export function BountyRow({
  name,
  sprite,
  kind,
  points,
  streak,
  status,
  urgent = false,
  isNew = false,
  cta = "Log it",
  kiosk = false,
  className,
  type = "button",
  ...props
}: BountyRowProps) {
  return (
    <button
      type={type}
      data-kind={kind}
      data-urgent={urgent ? "true" : "false"}
      className={cx(
        "flex w-full items-center gap-3 py-3 text-left text-bm-text sm:gap-4",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
        kiosk ? "min-h-24 py-4" : "min-h-16",
        className,
      )}
      {...props}
    >
      <BountyFace
        {...{ name, sprite, kind, points, streak, status, urgent, isNew }}
        kiosk={kiosk}
      />
      {/* Only for the eye: the row itself is the button. */}
      <span
        aria-hidden="true"
        className={cx(
          "pixel-frame shrink-0 items-center justify-center bg-bm-raised font-label font-bold text-bm-text uppercase [--pf:var(--color-bm-text)]",
          kiosk
            ? "inline-flex min-h-14 px-5 text-base"
            : "hidden min-h-11 px-4 text-sm sm:inline-flex",
        )}
      >
        {cta}
      </span>
    </button>
  );
}

/**
 * One bounty as a line in a widget, not a button: the hub's urgent list,
 * where `urgent` reddens the status line as it does on the board.
 */
export function BountySummary({
  name,
  sprite,
  kind,
  points,
  streak,
  status,
  urgent = false,
  isNew = false,
  className,
  ...props
}: BountyFields & Omit<HTMLAttributes<HTMLLIElement>, "children">) {
  return (
    <li
      data-kind={kind}
      data-urgent={urgent ? "true" : "false"}
      className={cx("flex items-center gap-3 py-3 text-bm-text", className)}
      {...props}
    >
      <BountyFace
        {...{ name, sprite, kind, points, streak, status, urgent, isNew }}
        kiosk={false}
      />
    </li>
  );
}

/** Bounty rows, one under the other with a line between. */
export function BountyList({
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

/** The accent a filter tab or a status tile's badge takes. */
export type TabAccent = "violet" | "red" | "yellow" | "amber" | "teal" | "pink";

const TAB_ON: Record<TabAccent, string> = {
  violet: "bg-bm-violet/15 [--pf:var(--color-bm-violet)]",
  red: "bg-bm-red/15 [--pf:var(--color-bm-red)]",
  yellow: "bg-bm-yellow/15 [--pf:var(--color-bm-yellow)]",
  amber: "bg-bm-amber/15 [--pf:var(--color-bm-amber)]",
  teal: "bg-bm-teal/15 [--pf:var(--color-bm-teal)]",
  pink: "bg-bm-pink/15 [--pf:var(--color-bm-pink)]",
};

const ACCENT_TEXT: Record<TabAccent, string> = {
  violet: "text-bm-violet",
  red: "text-bm-red",
  yellow: "text-bm-yellow",
  amber: "text-bm-amber",
  teal: "text-bm-teal",
  pink: "text-bm-pink",
};

const ACCENT_BG: Record<TabAccent, string> = {
  violet: "bg-bm-violet",
  red: "bg-bm-red",
  yellow: "bg-bm-yellow",
  amber: "bg-bm-amber",
  teal: "bg-bm-teal",
  pink: "bg-bm-pink",
};

/** The classes of one filter tab (a button or a link); `on` is chosen. */
export function tabClass(
  on: boolean,
  accent: TabAccent = "violet",
  kiosk = false,
): string {
  return cx(
    "pixel-frame inline-flex items-center justify-center gap-2 px-3 font-label font-bold whitespace-nowrap uppercase",
    kiosk ? "min-h-14 min-w-14 text-base" : "min-h-11 min-w-11 text-sm",
    on ? cx("text-bm-text", TAB_ON[accent]) : "text-bm-muted",
  );
}

/** A filter tab's label and its count, the count in the tab's accent. */
export function TabLabel({
  label,
  count,
  on,
  accent = "violet",
}: {
  label: string;
  count?: number;
  on: boolean;
  accent?: TabAccent;
}) {
  return (
    <>
      {label}
      {count !== undefined ? (
        <span
          className={cx(
            "font-display text-xs",
            on ? ACCENT_TEXT[accent] : "text-bm-dim",
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );
}

/** The classes of a status tile (a link); `active` has something to show. */
export function statusTileClass(active: boolean): string {
  return cx(
    "pixel-frame pixel-frame-4 relative inline-flex min-h-24 min-w-24 flex-col items-center justify-center gap-2 px-3 py-3",
    active ? "bg-bm-surface" : "[--pf:#221832]",
  );
}

/**
 * What a status tile shows (ADR 0005 §1): its 16-bit icon, its label and a
 * count badge in its accent; at zero the icon goes dim and the badge goes.
 * A null count is one that could not be read: no badge, and a quiet
 * "Unavailable" instead of a zero that would look like a real one.
 */
export function StatusTileFace({
  icon,
  label,
  count,
  accent,
}: {
  icon: PixelIconName;
  label: string;
  count: number | null;
  accent: TabAccent;
}) {
  const active = count !== null && count > 0;
  return (
    <>
      <PixelIcon name={icon} scale={3} dim={!active} />
      <span
        className={cx(
          "font-label text-xs font-bold tracking-wide uppercase",
          active ? "text-bm-muted" : "text-bm-dim",
        )}
      >
        {label}
      </span>
      {count === null ? (
        <span data-unavailable className="font-label text-xs text-bm-dim">
          Unavailable
        </span>
      ) : null}
      {active ? (
        <span
          data-count
          className={cx(
            "pixel-frame absolute top-1 right-1 grid h-7 min-w-7 place-items-center px-1 font-display text-xs leading-none text-bm-ink [--pf:transparent]",
            ACCENT_BG[accent],
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );
}

/**
 * One event in an agenda (the prototype's day sheet): the time large on the
 * left, a bar in the event's colour, the title and a line under it.
 */
export function AgendaItem({
  time,
  until,
  title,
  secondary,
  accent,
  className,
  style,
  ...props
}: Omit<HTMLAttributes<HTMLLIElement>, "title" | "children"> & {
  /** "19:00", or "All day". */
  time: string;
  /** "to 20:30", "till late"; optional. */
  until?: string;
  title: string;
  /** Where, or whose. */
  secondary?: ReactNode;
  /** The bar's colour (a CSS colour); violet without one. */
  accent?: string;
}) {
  return (
    <li
      className={cx(
        "flex items-stretch gap-3 py-3 [--chip:var(--color-bm-violet)] sm:gap-4",
        className,
      )}
      style={accent ? { ["--chip" as string]: accent, ...style } : style}
      {...props}
    >
      <span className="flex w-24 shrink-0 flex-col justify-center sm:w-28">
        <span className="font-display text-sm leading-snug text-bm-text sm:text-base">
          {time}
        </span>
        {until ? (
          <span className="mt-1 font-label text-xs text-bm-dim uppercase">
            {until}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="w-1.5 shrink-0 bg-(--chip)" />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="truncate text-xl leading-tight font-semibold">
          {title}
        </span>
        {secondary ? (
          <span className="truncate font-label text-xs text-bm-muted uppercase">
            {secondary}
          </span>
        ) : null}
      </span>
    </li>
  );
}
