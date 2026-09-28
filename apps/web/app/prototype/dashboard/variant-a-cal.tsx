"use client";

// PROTOTYPE (issue #7), throwaway. Variant A's calendar area: one full-month
// grid (the only home view) with a slim month title row. Tapping a day opens
// a calm day sheet that steps day by day without closing.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { eventsOn, TODAY_ISO, type CalEvent } from "./data";
import { F, framed, HM, K, notch, whoColor, whoName } from "./calm-kit";
import { Person } from "./pixels";

// ---------------------------------------------------------------- dates (UTC math, no local tz)
const DAY_MS = 86_400_000;
const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => toIso(parse(iso) + n * DAY_MS);
/** Monday = 0 … Sunday = 6. */
const dow = (iso: string) => (new Date(parse(iso)).getUTCDay() + 6) % 7;
const dom = (iso: string) => Number(iso.slice(8, 10));
const monthOf = (iso: string) => iso.slice(0, 7);
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return toIso(t.getTime()).slice(0, 7);
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WD_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const monName = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]!;

const snap = (n: number) => Math.round(n / 4) * 4;

const A2_CSS = `
.a2-noscroll { scrollbar-width: none; -ms-overflow-style: none; overscroll-behavior: contain; }
.a2-noscroll::-webkit-scrollbar { display: none; }
@keyframes a2-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
.a2-bob { animation: a2-bob 1.6s steps(2) infinite; display: inline-block; }
`;

function ArrowBtn({ dir, onClick, label, size = 56 }: { dir: -1 | 1; onClick: () => void; label: string; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`${F.press} grid shrink-0 place-items-center text-[18px]`}
      style={{ ...framed(K.line, K.raised, 3), color: K.muted, width: size, height: size }}
    >
      {dir < 0 ? "◀" : "▶"}
    </button>
  );
}

/** A native-scrolling list with the scrollbar hidden and a chunky pixel one drawn beside it. */
function PixelScroll({ children, endLabel, tone = K.bg }: { children: ReactNode; endLabel?: string; tone?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ top: 0, view: 0, full: 0, trackH: 0 });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setM({ top: el.scrollTop, view: el.clientHeight, full: el.scrollHeight, trackH: track.current?.clientHeight ?? 0 });
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    if (ref.current?.firstElementChild) ro.observe(ref.current.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);

  const scrollable = m.full > m.view + 2;
  const pad = 6;
  const inner = Math.max(0, m.trackH - pad * 2);
  const thumbH = scrollable ? Math.max(64, snap((inner * m.view) / m.full)) : 0;
  const maxTop = Math.max(1, m.full - m.view);
  const thumbTop = scrollable ? snap(((inner - thumbH) * m.top) / maxTop) : 0;
  const atEnd = !scrollable || m.top >= maxTop - 4;
  const atTop = m.top <= 4;

  // Tap or drag on the track jumps the list there.
  const seek = (clientY: number) => {
    const el = ref.current;
    const t = track.current;
    if (!el || !t || !scrollable) return;
    const r = t.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - r.top - pad - thumbH / 2) / Math.max(1, inner - thumbH)));
    el.scrollTop = f * maxTop;
  };

  const page = (dir: 1 | -1) => ref.current?.scrollBy({ top: dir * m.view * 0.75, behavior: "smooth" });

  // Stepped (dithered-looking) fade in the page colour.
  const fade: CSSProperties = {
    background: `linear-gradient(to bottom, transparent 0 20%, ${tone}55 20% 40%, ${tone}99 40% 60%, ${tone}dd 60% 80%, ${tone} 80%)`,
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="relative min-h-0 flex-1">
        <div ref={ref} data-agenda onScroll={measure} className="a2-noscroll h-full overflow-y-auto">
          <div className={endLabel ? "pb-[88px]" : "pb-[72px]"}>
            {children}
            {endLabel && (
              <div className={`${F.silk} py-6 text-center text-[14px] uppercase`} style={{ color: K.dim }}>
                ── {endLabel} ──
              </div>
            )}
          </div>
        </div>
        {!atTop && (
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 h-[28px]"
            style={{ background: `linear-gradient(to top, transparent 0 33%, ${tone}88 33% 66%, ${tone} 66%)` }}
          />
        )}
        {!atEnd && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex h-[110px] items-end justify-center pb-2" style={fade}>
            <button
              type="button"
              data-more
              onClick={() => page(1)}
              className={`${F.silk} pointer-events-auto flex h-[56px] items-center gap-3 px-6 text-[16px] font-bold uppercase`}
              style={{ ...framed(K.line, K.raised, 3), color: K.text }}
            >
              <span className="a2-bob" style={{ color: K.violet }}>
                ▼
              </span>
              More below
            </button>
          </div>
        )}
      </div>
      <div
        ref={track}
        data-track
        className="relative w-[24px] shrink-0 touch-none"
        style={{ ...framed(K.line, "#0f0918", 3), opacity: scrollable ? 1 : 0 }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(e.clientY);
        }}
      >
        {scrollable && (
          <div
            data-thumb
            className="absolute left-[6px] right-[6px]"
            style={{
              top: pad + thumbTop,
              height: thumbH,
              background: K.violet,
              boxShadow: `inset 3px 3px 0 #b8adff, inset -3px -3px 0 #5a4bc4`,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- month grid
function gridFor(ym: string) {
  const first = `${ym}-01`;
  const start = addDays(first, -dow(first));
  const next = `${addMonths(ym, 1)}-01`;
  const days = Math.round((parse(next) - parse(start)) / DAY_MS);
  const rows = Math.ceil(days / 7);
  return Array.from({ length: rows * 7 }, (_, i) => addDays(start, i));
}

// Cell geometry (px), shared by the render and the "how many chips fit" maths.
const CELL_PAD = 6;
const CELL_HEAD = 30;
const CHIP_H = 28;
const CHIP_GAP = 4;
const GRID_GAP = 6;

function Chip({ e, dim }: { e: CalEvent; dim: boolean }) {
  const c = whoColor(e.who);
  return (
    <div
      className={`${F.pix} flex shrink-0 items-center gap-[5px] overflow-hidden pr-1 text-[18px] leading-none`}
      style={{ height: CHIP_H, background: `${c}38`, color: K.text, opacity: dim ? 0.5 : 1 }}
    >
      <span className="block h-full w-[5px] shrink-0" style={{ background: c }} />
      <span className="truncate">{e.title}</span>
    </div>
  );
}

/** How many chip rows fit in one cell, measured from the grid's real height. */
function useChipRows(rows: number) {
  const ref = useRef<HTMLDivElement>(null);
  // Same first value on server and client; the effect refines it after mount.
  const [fit, setFit] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cellH = (el.clientHeight - GRID_GAP * (rows - 1)) / rows;
      const room = cellH - CELL_PAD * 2 - CELL_HEAD;
      setFit(Math.max(1, Math.floor((room + CHIP_GAP) / (CHIP_H + CHIP_GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows]);
  return [ref, fit] as const;
}

function MonthGrid({ ym, onPick }: { ym: string; onPick: (iso: string) => void }) {
  const cells = gridFor(ym);
  const rows = cells.length / 7;
  const [ref, fit] = useChipRows(rows);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 pb-2" style={{ gap: GRID_GAP }}>
        {WD.map((w, i) => (
          <div key={w} className={`${F.silk} text-center text-[15px] font-bold uppercase`} style={{ color: i >= 5 ? K.dim : K.muted }}>
            {w}
          </div>
        ))}
      </div>
      <div
        ref={ref}
        data-month={ym}
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{ gap: GRID_GAP, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {cells.map((iso) => {
          const inMonth = monthOf(iso) === ym;
          const isToday = iso === TODAY_ISO;
          const past = iso < TODAY_ISO;
          const evs = eventsOn(iso);
          // If they don't all fit, the last row becomes "+N more".
          const shown = evs.length > fit ? evs.slice(0, fit - 1) : evs;
          const extra = evs.length - shown.length;
          const frame: CSSProperties = isToday
            ? framed(K.violet, "#2a1c4a", 4)
            : inMonth
              ? { background: K.surface, ...notch(3) }
              : { background: "transparent", ...notch(3), boxShadow: `inset 0 0 0 2px ${K.line}` };
          return (
            <button
              key={iso}
              type="button"
              data-date={iso}
              onClick={() => onPick(iso)}
              className="flex min-h-0 flex-col overflow-hidden text-left"
              style={{ ...frame, padding: CELL_PAD, gap: CHIP_GAP, opacity: inMonth || isToday ? 1 : 0.4 }}
            >
              <div className="flex shrink-0 items-center justify-between" style={{ height: CELL_HEAD }}>
                <span
                  className={`${F.press} px-[5px] text-[20px] leading-[28px]`}
                  style={
                    isToday
                      ? { background: K.violet, color: K.ink }
                      : { color: past ? K.dim : dow(iso) >= 5 ? K.muted : K.text }
                  }
                >
                  {dom(iso)}
                </span>
              </div>
              {shown.map((e) => (
                <Chip key={e.start + e.title} e={e} dim={past && !isToday} />
              ))}
              {extra > 0 && (
                <div className={`${F.silk} shrink-0 pl-[4px] text-[14px] font-bold uppercase leading-[22px]`} style={{ color: past ? K.dim : K.muted }}>
                  +{extra} more
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- day sheet
function dayTitle(iso: string) {
  const rel = iso === TODAY_ISO ? "Today" : iso === addDays(TODAY_ISO, 1) ? "Tomorrow" : iso === addDays(TODAY_ISO, -1) ? "Yesterday" : null;
  return { rel, full: `${WD_LONG[dow(iso)]} ${dom(iso)} ${monName(iso)}` };
}

function WhoLine({ who }: { who: string }) {
  const h = HM[who];
  const c = whoColor(who);
  return (
    <span className={`${F.silk} flex items-center gap-3 text-[16px] font-bold uppercase`} style={{ color: c }}>
      {h ? (
        <Person id={h.id} hair={h.hair} shirt={h.shirt} scale={2} />
      ) : (
        <span className="block size-[14px]" style={{ background: c, ...notch(2) }} />
      )}
      {whoName(who)}
    </span>
  );
}

function DaySheet({ iso, onStep, onClose }: { iso: string; onStep: (n: -1 | 1) => void; onClose: () => void }) {
  const evs = eventsOn(iso);
  const past = iso < TODAY_ISO;
  const isToday = iso === TODAY_ISO;
  const { rel, full } = dayTitle(iso);
  return (
    <div className="cm-fade absolute inset-0 z-10 flex flex-col px-2 pb-2 pt-[76px]" style={{ background: "rgba(8,4,14,0.7)" }} onClick={onClose}>
      <section
        data-sheet={iso}
        className="cm-in flex min-h-0 flex-1 flex-col"
        style={framed(isToday ? K.violet : K.line, "#1e1432", 4)}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-4 px-6 pb-4 pt-6">
          <ArrowBtn dir={-1} label="Previous day" onClick={() => onStep(-1)} size={64} />
          <div className="min-w-0 flex-1 text-center">
            <div className={`${F.silk} text-[15px] font-bold uppercase`} style={{ color: isToday ? K.violet : K.muted }}>
              {rel ?? WD_LONG[dow(iso)]}
            </div>
            <div className={`${F.press} mt-3 text-[26px] leading-none`} style={{ color: K.text }}>
              {(rel ? full : `${dom(iso)} ${monName(iso)}`).toUpperCase()}
            </div>
          </div>
          <ArrowBtn dir={1} label="Next day" onClick={() => onStep(1)} size={64} />
        </header>
        <div className={`${F.silk} px-6 pb-3 text-center text-[14px] uppercase`} style={{ color: K.dim }}>
          {evs.length === 0 ? " " : `${evs.length} ${evs.length === 1 ? "thing" : "things"} planned${past ? " · done and dusted" : ""}`}
        </div>
        <div className="mx-6 h-[3px] shrink-0" style={{ background: K.line }} />
        <div className="flex min-h-0 flex-1 flex-col pl-6 pr-4 pt-2">
          {evs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-10">
              <div className={`${F.press} text-[22px]`} style={{ color: K.muted }}>
                NOTHING PLANNED
              </div>
              <div className={`${F.pix} text-[28px]`} style={{ color: K.dim }}>
                A free day. Baumy suggests a nap.
              </div>
            </div>
          ) : (
            <PixelScroll tone="#1e1432">
              {evs.map((e, i) => (
                <div
                  key={e.start + e.title}
                  data-event
                  className="flex items-center gap-5 py-5"
                  style={{ borderTop: i === 0 ? undefined : `2px solid ${K.line}`, opacity: past ? 0.6 : 1 }}
                >
                  <div className="w-[150px] shrink-0">
                    <div className={`${F.press} text-[26px] leading-none`}>{e.start}</div>
                    <div className={`${F.silk} mt-3 text-[15px] uppercase`} style={{ color: K.muted }}>
                      {e.end === "23:59" ? "till late" : `to ${e.end}`}
                    </div>
                  </div>
                  <span className="block h-[80px] w-[8px] shrink-0" style={{ background: whoColor(e.who) }} />
                  <div className="min-w-0 flex-1">
                    <div className={`${F.pix} text-[36px] font-semibold leading-[1.05]`}>{e.title}</div>
                    <div className="mt-3">
                      <WhoLine who={e.who} />
                    </div>
                  </div>
                </div>
              ))}
            </PixelScroll>
          )}
        </div>
        <div className="flex shrink-0 justify-center px-6 pb-6 pt-3">
          <button
            type="button"
            data-close-day
            onClick={onClose}
            className={`${F.press} flex h-[72px] w-full items-center justify-center gap-4 text-[18px]`}
            style={{ ...framed(K.line, K.raised, 4), color: K.text }}
          >
            <span style={{ color: K.muted }}>×</span> CLOSE
          </button>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- area
export function CalendarArea() {
  const [ym, setYm] = useState(monthOf(TODAY_ISO));
  const [picked, setPicked] = useState<string | null>(null);
  const onThisMonth = ym === monthOf(TODAY_ISO);
  const step = (n: -1 | 1) => {
    if (!picked) return;
    const d = addDays(picked, n);
    setPicked(d);
    setYm(monthOf(d));
  };
  return (
    <div className="relative flex h-full flex-col gap-3">
      <style>{A2_CSS}</style>
      <div className="flex h-[64px] shrink-0 items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ArrowBtn dir={-1} label="Previous month" onClick={() => setYm((y) => addMonths(y, -1))} />
          <span className={`${F.press} w-[330px] text-center text-[20px] leading-none`} style={{ color: K.text }}>
            {`${monName(`${ym}-01`)} ${ym.slice(0, 4)}`.toUpperCase()}
          </span>
          <ArrowBtn dir={1} label="Next month" onClick={() => setYm((y) => addMonths(y, 1))} />
        </div>
        <button
          type="button"
          data-today
          onClick={() => setYm(monthOf(TODAY_ISO))}
          className={`${F.silk} h-[56px] px-5 text-[16px] font-bold uppercase`}
          style={{ ...framed(onThisMonth ? K.line : K.violet, onThisMonth ? "transparent" : `${K.violet}22`, 3), color: onThisMonth ? K.dim : K.text }}
        >
          Today
        </button>
      </div>
      <MonthGrid ym={ym} onPick={setPicked} />
      {picked && <DaySheet iso={picked} onStep={step} onClose={() => setPicked(null)} />}
    </div>
  );
}
