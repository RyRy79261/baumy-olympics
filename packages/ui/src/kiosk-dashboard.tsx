import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from "react";
import { cx } from "./cx";
import { Glyph, PixelIcon } from "./pixel/glyph";
import type { GlyphName } from "./pixel/glyphs";
import type { PixelIconName } from "./pixel/icons";
import { PixelScroll } from "./pixel-scroll";

// The portrait kitchen dashboard in the pixel kit (ADR 0005; the approved
// prototype's variant A on proto/kiosk-home-pixel, calm-kit.tsx and
// variant-a-cal.tsx): the header's notification icons, the calm module they
// open (tabs, bounty rows, message rows), the month grid's day cells and
// chips, the day sheet's rows, and the footer nav. They take plain props and
// know nothing about chores, Google or the actions. One accent has one
// meaning (§8): red urgent, yellow new or points, pink messages, amber
// consumable, teal maintenance, violet today.

/** The accents a dashboard part can take. */
export type DashboardTone =
  "red" | "yellow" | "pink" | "amber" | "teal" | "violet" | "muted";

/** The CSS colour of an accent. */
export function toneColour(tone: DashboardTone): string {
  return `var(--color-bm-${tone})`;
}

/** `colour` at `pct`% over transparent: the prototype's `${hex}22` tints. */
export function tint(colour: string, pct: number): string {
  return `color-mix(in srgb, ${colour} ${pct}%, transparent)`;
}

/** A stepped pixel frame in `colour`, `width` px (the kit's pixel-frame). */
function frame(colour: string, width = 3): CSSProperties {
  return { ["--pf" as string]: colour, ["--pf-w" as string]: `${width}px` };
}

// ---------------------------------------------------------------- header

/**
 * One of the header's (at most three) notification icons: a 16-bit icon
 * over its label, with a count badge. At zero it goes dim and loses the
 * badge, but still opens its module (which then says there is nothing).
 * A count of null means it could not be read: dim too, with no badge, and
 * says "unavailable" rather than a zero that is not true.
 */
export function NotificationIcon({
  icon,
  label,
  count,
  tone,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: PixelIconName;
  label: string;
  count: number | null;
  tone: DashboardTone;
}) {
  const live = count !== null && count > 0;
  return (
    <button
      type={type}
      aria-label={`${label}: ${count ?? "unavailable"}`}
      data-count={count ?? undefined}
      data-status={count === null ? "unavailable" : "ready"}
      className={cx("relative block h-[124px] w-[120px] shrink-0", className)}
      {...props}
    >
      <span
        className={cx(
          "pixel-frame flex h-full w-full flex-col items-center justify-center gap-[10px]",
          live ? "bg-bm-surface" : "bg-transparent",
        )}
        style={frame(live ? "var(--color-bm-line)" : "#221832", 4)}
      >
        <PixelIcon name={icon} scale={4} dim={!live} className="block" />
        <span
          className={cx(
            "font-label text-[13px] font-bold tracking-wide uppercase",
            live ? "text-bm-muted" : "text-bm-dim",
          )}
        >
          {label}
        </span>
      </span>
      {live ? (
        <span
          data-badge
          aria-hidden
          className="pixel-frame absolute -top-2 -right-3 grid h-[34px] min-w-[34px] place-items-center px-[6px] font-display text-[15px] leading-none text-bm-ink"
          style={{ background: toneColour(tone), ...frame(toneColour(tone)) }}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------- module

/**
 * The calm module a header icon opens (ADR 0005 §1): a sheet framed in the
 * icon's accent, its icon, title and one line of what it lists, a close
 * button, optional tabs, and the list, which scrolls on its own.
 */
export function ModulePanel({
  title,
  titleId,
  icon,
  tone,
  subtitle,
  onClose,
  tabs,
  children,
}: {
  title: string;
  /** The heading's id, for the dialog's aria-labelledby. */
  titleId?: string;
  icon: PixelIconName;
  tone: DashboardTone;
  subtitle: string;
  onClose: () => void;
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="pixel-frame flex max-h-[960px] flex-col bg-[#1a1127] text-bm-text"
      style={frame(toneColour(tone), 4)}
    >
      <header className="flex items-center gap-4 px-7 pt-6 pb-4">
        <PixelIcon name={icon} scale={3} />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display text-[24px] text-bm-text">
            {title}
          </h2>
          <p className="mt-2 font-label text-[14px] text-bm-muted uppercase">
            {subtitle}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="pixel-frame grid size-16 shrink-0 place-items-center bg-bm-raised font-display text-[26px] text-bm-text"
          style={frame("var(--color-bm-line)", 4)}
        >
          ×
        </button>
      </header>
      {tabs ? <div className="px-7 pb-4">{tabs}</div> : null}
      <div className="flex min-h-0 flex-1 flex-col pr-4 pb-7 pl-7">
        <PixelScroll tone="#1a1127">{children}</PixelScroll>
      </div>
    </section>
  );
}

/** The module's tabs (All, Consumables, Maintenance), each with a count. */
export function SheetTabs<T extends string>({
  items,
  value,
  onPick,
}: {
  items: readonly {
    key: T;
    label: string;
    count: number;
    tone: DashboardTone;
  }[];
  value: T;
  onPick: (key: T) => void;
}) {
  return (
    <div className="flex gap-3" role="group" aria-label="Show">
      {items.map((it) => {
        const on = it.key === value;
        const c = toneColour(it.tone);
        return (
          <button
            key={it.key}
            type="button"
            data-tab={it.key}
            aria-pressed={on}
            onClick={() => onPick(it.key)}
            className={cx(
              "pixel-frame flex h-14 flex-1 items-center justify-center gap-3 font-label text-[16px] font-bold uppercase",
              on ? "text-bm-text" : "text-bm-muted",
            )}
            style={
              on
                ? { ...frame(c), background: tint(c, 13) }
                : frame("var(--color-bm-line)")
            }
          >
            {it.label}
            <span
              className="font-display text-[14px]"
              style={{ color: on ? c : "var(--color-bm-dim)" }}
            >
              {it.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The kind of a bounty: what it is and its accent. */
const KINDS = {
  consumable: { label: "Consumable", tone: "amber" },
  maintenance: { label: "Maintenance", tone: "teal" },
} as const;

/** How loudly a deadline is said: late is red, soon amber, later muted. */
const DUE_TONES = { late: "red", soon: "amber", later: "muted" } as const;

/** The class of a bounty row's action ("I'll do it"), a link or a button. */
export const bountyActionClass =
  "pixel-frame grid h-[60px] w-[132px] shrink-0 place-items-center bg-bm-raised font-label text-[15px] font-bold text-bm-text uppercase [--pf-w:3px] [--pf:var(--color-bm-text)]";

/**
 * One bounty: its glyph in its kind's colour, its name (and "new"), its kind
 * and whose streak you would steal, when it is due, its points, and the
 * action (a link to log it).
 */
export function BountyRow({
  glyph,
  name,
  kind,
  isNew = false,
  streak,
  due,
  points,
  action,
  ...props
}: HTMLAttributes<HTMLLIElement> & {
  glyph: GlyphName;
  name: string;
  kind: keyof typeof KINDS;
  isNew?: boolean;
  /** Who holds this chore's streak (in their colour), if anyone. */
  streak: { name: string; length: number; colour: string } | null;
  due: { text: string; tone: keyof typeof DUE_TONES };
  points: number | null;
  action: ReactNode;
}) {
  const k = KINDS[kind];
  const kc = toneColour(k.tone);
  return (
    <li
      className="flex items-center gap-4 border-t-2 border-bm-line py-4 first:border-t-0"
      {...props}
    >
      <span
        className="pixel-frame grid size-16 shrink-0 place-items-center"
        style={{ ...frame(tint(kc, 33)), background: tint(kc, 8) }}
      >
        <Glyph
          name={glyph}
          size={40}
          color={kc}
          accent="var(--color-bm-text)"
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="truncate font-body text-[30px] leading-none font-semibold">
            {name}
          </span>
          {isNew ? (
            <span className="font-label text-[13px] font-bold text-bm-yellow uppercase">
              new
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-2 overflow-hidden font-label text-[13px] whitespace-nowrap uppercase">
          <span style={{ color: kc }}>{k.label}</span>
          <span className="text-bm-dim">·</span>
          {streak ? (
            <span
              data-streak
              className="truncate"
              style={{ color: streak.colour }}
            >
              steal {streak.name}&apos;s {streak.length}× streak
            </span>
          ) : (
            <span className="text-bm-dim">no streak yet</span>
          )}
        </div>
      </div>
      <div className="w-[120px] shrink-0 text-right">
        <div
          data-due={due.tone}
          className="font-body text-[24px] leading-none"
          style={{ color: toneColour(DUE_TONES[due.tone]) }}
        >
          {due.text}
        </div>
        {points !== null ? (
          <div className="mt-2 font-display text-[14px] text-bm-yellow">
            +{points}
          </div>
        ) : null}
      </div>
      {action}
    </li>
  );
}

/** A module's empty state: "Nothing here. Baumy approves." */
export function ModuleEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="py-16 text-center font-body text-[28px] text-bm-muted">
      {children}
    </p>
  );
}

/** One message: who (their character, in their colour), when, and what. */
export function MessageRow({
  who,
  name,
  colour,
  when,
  title,
  children,
  ...props
}: HTMLAttributes<HTMLLIElement> & {
  /** Their Housemate. */
  who: ReactNode;
  name: string;
  colour: string;
  /** "12m ago". */
  when: string;
  title: string;
  /** The note's body, rendered by the caller (MarkdownBody). */
  children?: ReactNode;
}) {
  return (
    <li
      className="flex items-center gap-5 border-t-2 border-bm-line py-5 first:border-t-0"
      {...props}
    >
      {who}
      <div className="min-w-0 flex-1">
        <div
          className="font-label text-[15px] font-bold uppercase"
          style={{ color: colour }}
        >
          {name} <span className="text-bm-dim">· {when}</span>
        </div>
        <div className="mt-2 font-body text-[28px] leading-snug">{title}</div>
        {children ? (
          <div className="mt-1 line-clamp-2 font-body text-[20px] leading-snug text-bm-muted">
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- month grid

/**
 * Who is acting on the kitchen screen, in the month bar: their character and
 * name, and the way to stop (a "Done" submit the caller wraps in its form).
 * The next person sees at a glance whose name a tap would log under.
 */
export function ActingChip({
  who,
  name,
  done,
}: {
  /** Their Housemate. */
  who: ReactNode;
  name: string;
  /** The "Done" button. */
  done: ReactNode;
}) {
  return (
    <div
      data-testid="acting-chip"
      className="pixel-frame flex h-14 min-w-0 items-center gap-2 bg-bm-raised pl-2 [--pf-w:3px] [--pf:var(--color-bm-violet)]"
    >
      {who}
      <span
        data-testid="acting-as"
        className="min-w-0 truncate font-label text-[14px] font-bold text-bm-text uppercase"
      >
        {name}
      </span>
      {done}
    </div>
  );
}

/** The class of the acting chip's "Done": a 56px target. */
export const actingDoneClass =
  "grid h-14 min-w-14 place-items-center px-2 font-label text-[13px] font-bold text-bm-muted uppercase";

/** The class of the month bar's and the day sheet's ◀ ▶ (56px, 64px). */
export const kioskArrowClass =
  "pixel-frame grid shrink-0 place-items-center bg-bm-raised font-display text-[18px] text-bm-muted [--pf-w:3px] [--pf:var(--color-bm-line)]";

/** The class of the month bar's Today (dim while this month is shown). */
export function todayButtonClass(onThisMonth: boolean): string {
  return cx(
    "pixel-frame grid h-14 place-items-center px-5 font-label text-[16px] font-bold uppercase",
    onThisMonth
      ? "bg-transparent text-bm-dim"
      : "bg-[color-mix(in_srgb,var(--color-bm-violet)_13%,transparent)] text-bm-text [--pf:var(--color-bm-violet)]",
  );
}

/** One event in a month cell: its owner's colour bar and its title. */
export function EventChip({
  title,
  colour,
  dim = false,
}: {
  title: string;
  colour: string;
  /** A day gone by. */
  dim?: boolean;
}) {
  return (
    <span
      data-chip
      className={cx(
        "flex h-7 shrink-0 items-center gap-[5px] overflow-hidden pr-1 font-body text-[18px] leading-none text-bm-text",
        dim && "opacity-50",
      )}
      style={{ background: tint(colour, 22) }}
    >
      <span
        className="block h-full w-[5px] shrink-0"
        style={{ background: colour }}
      />
      <span className="truncate">{title}</span>
    </span>
  );
}

/**
 * One day of the month grid, a button that opens its day sheet: the date
 * (today in a violet block), then the chips that fit and "+N more". Days of
 * the months either side are faint.
 */
export function MonthDayCell({
  date,
  inMonth,
  today = false,
  past = false,
  weekend = false,
  more = 0,
  children,
  className,
  style,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  date: number;
  inMonth: boolean;
  today?: boolean;
  past?: boolean;
  weekend?: boolean;
  /** How many events did not fit. */
  more?: number;
  /** The chips. */
  children?: ReactNode;
}) {
  return (
    <button
      type={type}
      aria-current={today ? "date" : undefined}
      className={cx(
        "pixel-frame flex min-h-0 flex-col gap-1 overflow-hidden p-1.5 text-left",
        today
          ? "bg-[#2a1c4a] [--pf-w:4px] [--pf:var(--color-bm-violet)]"
          : inMonth
            ? "bg-bm-surface [--pf:transparent]"
            : "bg-transparent [--pf-w:2px]",
        !inMonth && !today && "opacity-40",
        className,
      )}
      style={style}
      {...props}
    >
      <span className="flex h-[30px] shrink-0 items-center">
        <span
          className={cx(
            "px-[5px] font-display text-[20px] leading-[28px]",
            today
              ? "bg-bm-violet text-bm-ink"
              : past
                ? "text-bm-dim"
                : weekend
                  ? "text-bm-muted"
                  : "text-bm-text",
          )}
        >
          {date}
        </span>
      </span>
      {children}
      {more > 0 ? (
        <span
          className={cx(
            "shrink-0 pl-1 font-label text-[14px] leading-[22px] font-bold uppercase",
            past && !today ? "text-bm-dim" : "text-bm-muted",
          )}
        >
          +{more} more
        </span>
      ) : null}
    </button>
  );
}

/** The month grid's Mon … Sun row; the weekend is dimmer. */
export function WeekdayRow({ gap }: { gap: number }) {
  return (
    <div aria-hidden className="grid shrink-0 grid-cols-7 pb-2" style={{ gap }}>
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
        <span
          key={d}
          className={cx(
            "text-center font-label text-[15px] font-bold uppercase",
            i >= 5 ? "text-bm-dim" : "text-bm-muted",
          )}
        >
          {d}
        </span>
      ))}
    </div>
  );
}

/** One event in the day sheet: its time, its owner's bar, title and who. */
export function DayEventRow({
  start,
  end,
  colour,
  title,
  who,
  dim = false,
}: {
  /** "07:30" or "All day". */
  start: string;
  /** "to 08:00", "till late", or "". */
  end: string;
  colour: string;
  title: string;
  /** Their Housemate and name, or the house's mark. */
  who: ReactNode;
  dim?: boolean;
}) {
  return (
    <div
      data-event
      className={cx(
        "flex items-center gap-5 border-t-2 border-bm-line py-5 first:border-t-0",
        dim && "opacity-60",
      )}
    >
      <div className="w-[150px] shrink-0">
        <div
          className={cx(
            "font-display leading-none",
            start.length > 5 ? "text-[18px]" : "text-[26px]",
          )}
        >
          {start}
        </div>
        {end ? (
          <div className="mt-3 font-label text-[15px] text-bm-muted uppercase">
            {end}
          </div>
        ) : null}
      </div>
      <span
        className="block h-20 w-2 shrink-0"
        style={{ background: colour }}
      />
      <div className="min-w-0 flex-1">
        <div className="font-body text-[36px] leading-[1.05] font-semibold">
          {title}
        </div>
        <div className="mt-3">{who}</div>
      </div>
    </div>
  );
}

/** Who an event is from, in the day sheet: a character (or a dot) and a name. */
export function WhoLine({
  who,
  name,
  colour,
}: {
  /** Their Housemate; none for the house. */
  who?: ReactNode;
  name: string;
  colour: string;
}) {
  return (
    <span
      className="flex items-center gap-3 font-label text-[16px] font-bold uppercase"
      style={{ color: colour }}
    >
      {who ?? (
        <span
          className="pixel-frame block size-3.5 [--pf-w:2px]"
          style={{ background: colour, ["--pf" as string]: colour }}
        />
      )}
      {name}
    </span>
  );
}

// ---------------------------------------------------------------- footer

/** The footer bar's height, and the room Baumy keeps at its right end. */
export const KIOSK_FOOTER_H = 84;

/** The class of one footer nav item (a link). */
export function kioskNavItemClass(active: boolean): string {
  return cx(
    "flex flex-1 flex-col items-center justify-center gap-1.5 font-label text-[11px] uppercase",
    active ? "text-bm-text" : "text-bm-dim",
  );
}

/** A footer nav item's glyph over its label. */
export function KioskNavItem({
  glyph,
  label,
}: {
  glyph: GlyphName;
  label: string;
}) {
  return (
    <>
      <Glyph name={glyph} size={26} />
      <span>{label}</span>
    </>
  );
}

/** The small footer nav along the bottom; Baumy sits over its right end. */
export function KioskFooter({ children }: { children: ReactNode }) {
  return (
    <nav
      aria-label="Kiosk"
      className="absolute right-0 bottom-0 left-0 flex items-stretch border-t-2 border-bm-line bg-bm-chrome pr-[160px] pl-3"
      style={{ height: KIOSK_FOOTER_H }}
    >
      {children}
    </nav>
  );
}
