"use client";

// PROTOTYPE (issue #7), throwaway. The shared calm skeleton: slim header
// (date, big clock, at most three notification icons), a full-width
// calendar slot, a tiny footer nav, the Baumy voice button, the bounty /
// messages module, and the reminder + screensaver wiring.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BaumyCat } from "./baumy-cat";
import { HOUSEMATES, MESSAGES, type Bounty } from "./data";
import type { PixelIcon } from "./calm-icons";
import { VC_CSS } from "./overlay-chrome";
import { Glyph, Person, Px, type GlyphName } from "./pixels";
import { hhmm, Reminder, Screensaver } from "./shared-overlays";

export const K = {
  bg: "#140c1f",
  surface: "#1c1229",
  raised: "#251838",
  line: "#2e2145",
  ink: "#0b0712",
  text: "#f7ecff",
  muted: "#a898c4",
  dim: "#6a5b8a",
  red: "#ff4d5e",
  yellow: "#ffe46b",
  amber: "#ffb347",
  teal: "#4ff5e6",
  pink: "#ff8fc7",
  violet: "#8f7dff",
  green: "#43f0a0",
} as const;

export const F = {
  press: "font-[family-name:var(--font-press)]",
  vt: "font-[family-name:var(--font-vt)]",
  silk: "font-[family-name:var(--font-silk)]",
  pix: "font-[family-name:var(--font-pixelify)]",
};

export const HM = Object.fromEntries(HOUSEMATES.map((h) => [h.id, h])) as Record<
  string,
  (typeof HOUSEMATES)[number]
>;
export const whoColor = (who: string) => (who === "house" ? K.amber : (HM[who]?.color ?? K.muted));
export const whoName = (who: string) => (who === "house" ? "House" : (HM[who]?.name ?? who));
export const taxColor = (t: Bounty["taxonomy"]) => (t === "consumables" ? K.amber : K.teal);
export const taxLabel = (t: Bounty["taxonomy"]) => (t === "consumables" ? "Consumable" : "Maintenance");

/** A pixel-rounded frame: square corners notched out, an inset border. */
export const notch = (n = 4): CSSProperties => ({
  clipPath: `polygon(${n}px 0, calc(100% - ${n}px) 0, calc(100% - ${n}px) ${n}px, 100% ${n}px, 100% calc(100% - ${n}px), calc(100% - ${n}px) calc(100% - ${n}px), calc(100% - ${n}px) 100%, ${n}px 100%, ${n}px calc(100% - ${n}px), 0 calc(100% - ${n}px), 0 ${n}px, ${n}px ${n}px)`,
});
export const framed = (border: string, bg: string = K.surface, n = 4): CSSProperties => ({
  background: bg,
  boxShadow: `inset 0 0 0 ${n}px ${border}`,
  ...notch(n),
});

// A fixed "now" for the mockup (Mon 28 Sep 2026, 17:42), ticking from mount.
export const START = new Date(2026, 8, 28, 17, 42, 5).getTime();
const IDLE_MS = 60_000;

const CALM_CSS = `
@keyframes cm-in { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.cm-in { animation: cm-in 0.2s steps(4) both; }
@keyframes cm-fade { from { opacity: 0; } to { opacity: 1; } }
.cm-fade { animation: cm-fade 0.2s steps(4) both; }
@keyframes cm-eq { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
.cm-eq { animation: cm-eq 0.9s steps(3) infinite; transform-origin: bottom; }
@keyframes cm-now { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.cm-now { animation: cm-now 2.4s steps(2) infinite; }
`;

// ---------------------------------------------------------------- icons
export type Badge = { n: number; color: string };
export type IconSpec = {
  key: string;
  label: string;
  icon: PixelIcon;
  badges: Badge[];
  module: (close: () => void) => ReactNode;
};

function BadgeChip({ b, style }: { b: Badge; style: CSSProperties }) {
  return (
    <span
      className={`${F.press} absolute grid h-[34px] min-w-[34px] place-items-center px-[6px] text-[15px] leading-none`}
      style={{ background: b.color, color: K.ink, ...notch(3), ...style }}
    >
      {b.n}
    </span>
  );
}

function NotifButton({ spec, onOpen }: { spec: IconSpec; onOpen: () => void }) {
  const live = spec.badges.filter((b) => b.n > 0);
  const active = live.length > 0;
  return (
    <button type="button" data-icon={spec.key} onClick={onOpen} className="relative block h-[124px] w-[120px]">
      <span
        className="flex h-full w-full flex-col items-center justify-center gap-[10px]"
        style={framed(active ? K.line : "#221832", active ? K.surface : "transparent", 4)}
      >
        <Px
          grid={spec.icon.grid}
          pal={spec.icon.pal}
          scale={4}
          className="block"
          style={{ opacity: active ? 1 : 0.28, filter: active ? undefined : "grayscale(1)" }}
        />
        <span className={`${F.silk} text-[13px] font-bold uppercase tracking-wide`} style={{ color: active ? K.muted : K.dim }}>
          {spec.label}
        </span>
      </span>
      {live.map((b, i) => (
        <BadgeChip key={i} b={b} style={{ top: -8 + i * 40, right: -12 }} />
      ))}
    </button>
  );
}

// ---------------------------------------------------------------- footer + voice
const NAV: { l: string; g: GlyphName }[] = [
  { l: "Home", g: "home" },
  { l: "Bounties", g: "board" },
  { l: "Calendar", g: "calendar" },
  { l: "Board", g: "msg" },
  { l: "Shop", g: "shop" },
  { l: "Scores", g: "trophy" },
];

export const FOOTER_H = 84;
export const HEADER_H = 156;
/** The calendar slot: below the header, above the footer and the raised voice button. */
export const BODY_STYLE: CSSProperties = { top: HEADER_H, bottom: FOOTER_H + 64, left: 24, right: 24 };

function Footer() {
  return (
    <>
      <nav
        className="absolute bottom-0 left-0 right-0 flex items-stretch pl-3 pr-[160px]"
        style={{ height: FOOTER_H, background: "#0f0918", borderTop: `2px solid ${K.line}` }}
      >
        {NAV.map((n, i) => {
          const on = i === 0;
          return (
            <button key={n.l} type="button" className="flex flex-1 flex-col items-center justify-center gap-[6px]">
              <Glyph name={n.g} size={26} color={on ? K.text : K.dim} shadow={false} />
              <span className={`${F.silk} text-[11px] uppercase`} style={{ color: on ? K.text : K.dim }}>
                {n.l}
              </span>
            </button>
          );
        })}
      </nav>
      <BaumyCat scale={3} />
    </>
  );
}

// ---------------------------------------------------------------- shell
export function CalmShell({ icons, calendar }: { icons: IconSpec[]; calendar: (now: Date) => ReactNode }) {
  const [now, setNow] = useState(() => new Date(START));
  const [open, setOpen] = useState<string | null>(null);
  const [reminder, setReminder] = useState(false);
  const [saver, setSaver] = useState(false);
  const idle = useRef<number | undefined>(undefined);

  useEffect(() => {
    const t0 = Date.now();
    const t = window.setInterval(() => setNow(new Date(START + Date.now() - t0)), 1000);
    return () => window.clearInterval(t);
  }, []);

  const poke = useCallback(() => {
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setSaver(true), IDLE_MS);
  }, []);

  useEffect(() => {
    const onReminder = () => {
      setSaver(false);
      setReminder(true);
    };
    const onSaver = () => setSaver(true);
    window.addEventListener("proto:reminder", onReminder);
    window.addEventListener("proto:screensaver", onSaver);
    window.addEventListener("pointerdown", poke);
    window.addEventListener("keydown", poke);
    poke();
    return () => {
      window.removeEventListener("proto:reminder", onReminder);
      window.removeEventListener("proto:screensaver", onSaver);
      window.removeEventListener("pointerdown", poke);
      window.removeEventListener("keydown", poke);
      window.clearTimeout(idle.current);
    };
  }, [poke]);

  const spec = icons.find((i) => i.key === open);
  const close = () => setOpen(null);

  return (
    <div className="relative h-[1180px] w-[820px] select-none overflow-hidden" style={{ background: K.bg, color: K.text }}>
      <style>{VC_CSS + CALM_CSS}</style>
      <header className="absolute left-0 right-0 top-0 flex items-center justify-between px-6" style={{ height: HEADER_H }}>
        <div>
          <div className={`${F.silk} text-[20px] font-bold uppercase tracking-wider`} style={{ color: K.muted }}>
            Monday 28 September
          </div>
          <div className={`${F.press} mt-3 text-[64px] leading-none`} style={{ color: K.text }}>
            {hhmm(now)}
          </div>
        </div>
        <div className="flex gap-6 pr-2 pt-2">
          {icons.map((s) => (
            <NotifButton key={s.key} spec={s} onOpen={() => setOpen(s.key)} />
          ))}
        </div>
      </header>
      <main className="absolute" style={BODY_STYLE}>
        {calendar(now)}
      </main>
      <Footer />
      {spec && (
        <div
          className="cm-fade absolute inset-0 z-40 flex items-start justify-center px-6 pt-[120px]"
          style={{ background: "rgba(8,4,14,0.82)" }}
          onClick={close}
          data-module
        >
          <div className="cm-in w-full" onClick={(e) => e.stopPropagation()}>
            {spec.module(close)}
          </div>
        </div>
      )}
      {reminder && <Reminder onClose={() => setReminder(false)} />}
      {saver && <Screensaver now={now} onWake={() => setSaver(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- module
export function ModuleSheet({
  title,
  icon,
  accent,
  subtitle,
  onClose,
  tabs,
  children,
}: {
  title: string;
  icon: PixelIcon;
  accent: string;
  subtitle: string;
  onClose: () => void;
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex max-h-[960px] flex-col" style={framed(accent, "#1a1127", 4)}>
      <header className="flex items-center gap-4 px-7 pb-4 pt-6">
        <Px grid={icon.grid} pal={icon.pal} scale={3} />
        <div className="flex-1">
          <div className={`${F.press} text-[24px]`} style={{ color: K.text }}>
            {title}
          </div>
          <div className={`${F.silk} mt-2 text-[14px] uppercase`} style={{ color: K.muted }}>
            {subtitle}
          </div>
        </div>
        <button
          type="button"
          data-close
          onClick={onClose}
          aria-label="Close"
          className={`${F.press} grid size-[64px] place-items-center text-[26px]`}
          style={{ ...framed(K.line, K.raised, 4), color: K.text }}
        >
          ×
        </button>
      </header>
      {tabs && <div className="px-7 pb-4">{tabs}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7">{children}</div>
    </section>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onPick,
}: {
  items: { k: T; l: string; n: number; color: string }[];
  value: T;
  onPick: (k: T) => void;
}) {
  return (
    <div className="flex gap-3">
      {items.map((it) => {
        const on = it.k === value;
        return (
          <button
            key={it.k}
            type="button"
            data-tab={it.k}
            onClick={() => onPick(it.k)}
            className={`${F.silk} flex h-[56px] flex-1 items-center justify-center gap-3 text-[16px] font-bold uppercase`}
            style={on ? { ...framed(it.color, `${it.color}22`, 3), color: K.text } : { ...framed(K.line, "transparent", 3), color: K.muted }}
          >
            {it.l}
            <span className={F.press} style={{ color: on ? it.color : K.dim, fontSize: 14 }}>
              {it.n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function dueText(h: number) {
  if (h < 0) return { t: `${-h}h late`, c: K.red };
  if (h <= 12) return { t: `in ${h}h`, c: K.amber };
  if (h < 36) return { t: `in ${h}h`, c: K.muted };
  return { t: `in ${Math.round(h / 24)} days`, c: K.muted };
}

export function BountyRows({ list }: { list: Bounty[] }) {
  const [mine, setMine] = useState<Set<string>>(new Set());
  if (list.length === 0) {
    return (
      <div className={`${F.pix} py-16 text-center text-[28px]`} style={{ color: K.muted }}>
        Nothing here. Baumy approves.
      </div>
    );
  }
  return (
    <ul className="flex flex-col">
      {[...list]
        .sort((a, b) => a.dueInHours - b.dueInHours)
        .map((b, i) => {
          const tc = taxColor(b.taxonomy);
          const d = dueText(b.dueInHours);
          const holder = b.streak ? HM[b.streak.who] : null;
          const taken = mine.has(b.id);
          return (
            <li
              key={b.id}
              data-row={b.id}
              className="flex items-center gap-4 py-4"
              style={{ borderTop: i === 0 ? undefined : `2px solid ${K.line}`, opacity: taken ? 0.55 : 1 }}
            >
              <span className="grid size-[64px] shrink-0 place-items-center" style={framed(`${tc}55`, `${tc}14`, 3)}>
                <Glyph name={b.icon as GlyphName} size={40} color={tc} accent={K.text} shadow={false} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className={`${F.pix} truncate text-[30px] font-semibold leading-none`}>{b.title}</span>
                  {b.isNew && (
                    <span className={`${F.silk} text-[13px] font-bold uppercase`} style={{ color: K.yellow }}>
                      new
                    </span>
                  )}
                </div>
                <div className={`${F.silk} mt-2 flex items-center gap-2 whitespace-nowrap text-[13px] uppercase`}>
                  <span style={{ color: tc }}>{taxLabel(b.taxonomy)}</span>
                  <span style={{ color: K.dim }}>·</span>
                  {holder && b.streak ? (
                    <span style={{ color: holder.color }}>
                      steal {holder.name}&apos;s {b.streak.n}× streak
                    </span>
                  ) : (
                    <span style={{ color: K.dim }}>no streak yet</span>
                  )}
                </div>
              </div>
              <div className="w-[120px] shrink-0 text-right">
                <div className={`${F.pix} text-[24px] leading-none`} style={{ color: d.c }}>
                  {d.t}
                </div>
                <div className={`${F.press} mt-2 text-[14px]`} style={{ color: K.yellow }}>
                  +{b.reward}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setMine((s) => {
                    const n = new Set(s);
                    if (n.has(b.id)) n.delete(b.id);
                    else n.add(b.id);
                    return n;
                  })
                }
                className={`${F.silk} h-[60px] w-[132px] shrink-0 text-[15px] font-bold uppercase`}
                style={taken ? { ...framed(K.green, K.green, 3), color: K.ink } : { ...framed(K.text, K.raised, 3), color: K.text }}
              >
                {taken ? "Yours ✓" : "I'll do it"}
              </button>
            </li>
          );
        })}
    </ul>
  );
}

export function MessageRows() {
  return (
    <ul className="flex flex-col">
      {MESSAGES.map((m, i) => {
        const h = HM[m.who]!;
        return (
          <li key={i} className="flex items-center gap-5 py-5" style={{ borderTop: i === 0 ? undefined : `2px solid ${K.line}` }}>
            <Person id={h.id} hair={h.hair} shirt={h.shirt} scale={4} />
            <div className="min-w-0 flex-1">
              <div className={`${F.silk} text-[15px] font-bold uppercase`} style={{ color: h.color }}>
                {h.name} <span style={{ color: K.dim }}>· {m.ago} ago</span>
              </div>
              <div className={`${F.pix} mt-2 text-[28px] leading-snug`}>{m.text}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The Messages icon every variant shares. */
export function messagesSpec(icon: PixelIcon): IconSpec {
  return {
    key: "messages",
    label: "Messages",
    icon,
    badges: [{ n: MESSAGES.length, color: K.pink }],
    module: (close) => (
      <ModuleSheet title="Messages" icon={icon} accent={K.pink} subtitle={`${MESSAGES.length} on the house board`} onClose={close}>
        <MessageRows />
      </ModuleSheet>
    ),
  };
}

// ---------------------------------------------------------------- calendar helpers
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DATES = [28, 29, 30, 1, 2, 3, 4];
export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
};
export const nowMin = (d: Date) => d.getHours() * 60 + d.getMinutes();
