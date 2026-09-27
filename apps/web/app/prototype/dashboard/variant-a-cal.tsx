"use client";

// PROTOTYPE (issue #7), throwaway. Variant A's calendar area: a calm
// Week | Month toggle, a continuous scrolling agenda (today pinned above it)
// with a chunky pixel scrollbar, and a month grid whose days open a sheet.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { eventsOn, MONTH_EVENTS, TODAY_ISO, type CalEvent } from "./data";
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
const shortMon = (iso: string) => monName(iso).slice(0, 3);

const snap = (n: number) => Math.round(n / 4) * 4;

const A2_CSS = `
.a2-noscroll { scrollbar-width: none; -ms-overflow-style: none; overscroll-behavior: contain; }
.a2-noscroll::-webkit-scrollbar { display: none; }
@keyframes a2-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
.a2-bob { animation: a2-bob 1.6s steps(2) infinite; display: inline-block; }
`;

// ---------------------------------------------------------------- toggle
type View = "week" | "month";

function ListIcon({ c }: { c: string }) {
  return (
    <span className="flex flex-col gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex gap-[3px]">
          <span className="block size-[4px]" style={{ background: c }} />
          <span className="block h-[4px] w-[14px]" style={{ background: c }} />
        </span>
      ))}
    </span>
  );
}

function GridIcon({ c }: { c: string }) {
  return (
    <span className="grid grid-cols-3 gap-[3px]">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="block size-[5px]" style={{ background: c }} />
      ))}
    </span>
  );
}

function ViewToggle({ view, onPick }: { view: View; onPick: (v: View) => void }) {
  const opts: { k: View; l: string }[] = [
    { k: "week", l: "Week" },
    { k: "month", l: "Month" },
  ];
  return (
    <div className="flex p-[6px]" style={framed(K.line, "#0f0918", 3)} role="tablist" aria-label="Calendar view">
      {opts.map((o) => {
        const on = o.k === view;
        const c = on ? K.text : K.muted;
        return (
          <button
            key={o.k}
            type="button"
            role="tab"
            aria-selected={on}
            data-view={o.k}
            onClick={() => onPick(o.k)}
            className={`${F.silk} flex h-[56px] w-[138px] items-center justify-center gap-3 text-[17px] font-bold uppercase`}
            style={on ? { ...framed(K.violet, `${K.violet}33`, 3), color: c } : { color: c }}
          >
            {o.k === "week" ? <ListIcon c={on ? K.violet : K.dim} /> : <GridIcon c={on ? K.violet : K.dim} />}
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function ArrowBtn({ dir, onClick, label }: { dir: -1 | 1; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`${F.press} grid size-[56px] shrink-0 place-items-center text-[18px]`}
      style={{ ...framed(K.line, K.raised, 3), color: K.muted }}
    >
      {dir < 0 ? "◀" : "▶"}
    </button>
  );
}

// ---------------------------------------------------------------- shared bits
function WhoTag({ who, size = 13 }: { who: string; size?: number }) {
  return (
    <span className={`${F.silk} uppercase`} style={{ color: whoColor(who), fontSize: size }}>
      {whoName(who)}
    </span>
  );
}

// ---------------------------------------------------------------- agenda
const AGENDA_DAYS = 21;

function weekLabel(monday: string) {
  const sun = addDays(monday, 6);
  const range =
    monthOf(monday) === monthOf(sun)
      ? `${dom(monday)}–${dom(sun)} ${shortMon(monday)}`
      : `${dom(monday)} ${shortMon(monday)} – ${dom(sun)} ${shortMon(sun)}`;
  const weeksOut = Math.round((parse(monday) - parse(TODAY_ISO)) / (7 * DAY_MS));
  // TODAY_ISO is a Monday, so the next Monday is exactly one week out.
  const name = weeksOut === 1 ? "Next week" : `In ${weeksOut} weeks`;
  return { name, range };
}

function AgendaDay({ iso }: { iso: string }) {
  const evs = eventsOn(iso);
  const d = dow(iso);
  const tomorrow = iso === addDays(TODAY_ISO, 1);
  const weekend = d >= 5;
  const first = dom(iso) === 1;
  return (
    <div
      data-day={iso}
      className={`flex gap-5 px-2 ${evs.length ? "py-4" : "py-3"}`}
      style={{ borderTop: `2px solid ${K.line}` }}
    >
      <div className="w-[118px] shrink-0 pt-[2px]">
        <div className={`${F.silk} text-[15px] font-bold uppercase`} style={{ color: tomorrow ? K.text : K.muted }}>
          {tomorrow ? "Tomorrow" : WD[d]}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`${F.press} text-[22px]`} style={{ color: weekend ? K.muted : K.text }}>
            {dom(iso)}
          </span>
          {first && (
            <span className={`${F.silk} text-[13px] font-bold uppercase`} style={{ color: K.violet }}>
              {shortMon(iso)}
            </span>
          )}
        </div>
      </div>
      {evs.length === 0 ? (
        <div className={`${F.pix} flex items-center text-[22px]`} style={{ color: K.dim }}>
          Nothing planned
        </div>
      ) : (
        <ul className="flex min-w-0 flex-1 flex-col gap-3">
          {evs.map((e) => (
            <li key={e.start + e.title} className="flex items-stretch gap-3">
              <span className="block w-[6px] shrink-0" style={{ background: whoColor(e.who) }} />
              <div className="min-w-0">
                <div className={`${F.pix} text-[27px] leading-[1.1]`}>{e.title}</div>
                <div className={`${F.silk} mt-[6px] text-[13px] uppercase`} style={{ color: K.muted }}>
                  {e.start}
                  {e.end !== "23:59" ? `–${e.end}` : " till late"} · <WhoTag who={e.who} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WeekDivider({ monday }: { monday: string }) {
  const { name, range } = weekLabel(monday);
  return (
    <div className="flex items-center gap-4 px-2 pb-3 pt-7" data-week={monday}>
      <span className={`${F.press} text-[15px]`} style={{ color: K.violet }}>
        {name.toUpperCase()}
      </span>
      <span className={`${F.silk} text-[14px] font-bold uppercase`} style={{ color: K.muted }}>
        {range}
      </span>
      <span className="h-[2px] flex-1" style={{ background: `repeating-linear-gradient(90deg, ${K.line} 0 6px, transparent 6px 12px)` }} />
    </div>
  );
}

/** A native-scrolling list with the scrollbar hidden and a chunky pixel one drawn beside it. */
function PixelScroll({ children, endLabel }: { children: ReactNode; endLabel: string }) {
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
    background: `linear-gradient(to bottom, transparent 0 20%, ${K.bg}55 20% 40%, ${K.bg}99 40% 60%, ${K.bg}dd 60% 80%, ${K.bg} 80%)`,
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="relative min-h-0 flex-1">
        <div ref={ref} data-agenda onScroll={measure} className="a2-noscroll h-full overflow-y-auto">
          <div className="pb-[88px]">
            {children}
            <div className={`${F.silk} py-6 text-center text-[14px] uppercase`} style={{ color: K.dim }}>
              ── {endLabel} ──
            </div>
          </div>
        </div>
        {!atTop && (
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 h-[28px]"
            style={{ background: `linear-gradient(to top, transparent 0 33%, ${K.bg}88 33% 66%, ${K.bg} 66%)` }}
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
        style={{ ...framed(K.line, "#0f0918", 3), opacity: scrollable ? 1 : 0.3 }}
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

function Agenda() {
  const days = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(TODAY_ISO, i + 1));
  const last = days[days.length - 1]!;
  return (
    <PixelScroll endLabel={`That's everything to ${WD[dow(last)]} ${dom(last)} ${shortMon(last)}`}>
      {days.map((iso) => (
        <div key={iso}>
          {dow(iso) === 0 && <WeekDivider monday={iso} />}
          <AgendaDay iso={iso} />
        </div>
      ))}
    </PixelScroll>
  );
}

// ---------------------------------------------------------------- month
function gridFor(ym: string) {
  const first = `${ym}-01`;
  const start = addDays(first, -dow(first));
  const next = `${addMonths(ym, 1)}-01`;
  const days = Math.round((parse(next) - parse(start)) / DAY_MS);
  const rows = Math.ceil(days / 7);
  return Array.from({ length: rows * 7 }, (_, i) => addDays(start, i));
}

function Chip({ e, dim }: { e: CalEvent; dim: boolean }) {
  const c = whoColor(e.who);
  return (
    <div
      className={`${F.pix} flex h-[26px] items-center gap-[6px] overflow-hidden pr-1 text-[16px] leading-none`}
      style={{ background: `${c}24`, opacity: dim ? 0.5 : 1 }}
    >
      <span className="block h-full w-[5px] shrink-0" style={{ background: c }} />
      <span className="truncate">{e.title}</span>
    </div>
  );
}

function DaySheet({ iso, top, onClose }: { iso: string; top: boolean; onClose: () => void }) {
  const evs = eventsOn(iso);
  const past = iso < TODAY_ISO;
  const isToday = iso === TODAY_ISO;
  return (
    <div className="cm-fade absolute inset-0 z-10 flex flex-col" style={{ background: "rgba(8,4,14,0.6)" }} onClick={onClose}>
      {!top && <div className="flex-1" />}
      <section
        data-sheet={iso}
        className="cm-in flex max-h-[62%] min-h-[300px] flex-col"
        style={framed(K.violet, "#1e1432", 4)}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-4 px-7 pb-3 pt-6">
          <div className="flex-1">
            <div className={`${F.press} text-[22px]`} style={{ color: isToday ? K.violet : K.text }}>
              {isToday ? "TODAY" : `${WD_LONG[dow(iso)]!.toUpperCase()} ${dom(iso)}`}
            </div>
            <div className={`${F.silk} mt-2 text-[14px] uppercase`} style={{ color: K.muted }}>
              {isToday ? `${WD_LONG[dow(iso)]} ${dom(iso)} ${monName(iso)}` : monName(iso)} ·{" "}
              {evs.length === 0 ? "nothing planned" : `${evs.length} ${evs.length === 1 ? "thing" : "things"}${past ? " · past" : ""}`}
            </div>
          </div>
          <button
            type="button"
            data-close-day
            onClick={onClose}
            aria-label="Close day"
            className={`${F.press} grid size-[64px] place-items-center text-[26px]`}
            style={{ ...framed(K.line, K.raised, 4), color: K.text }}
          >
            ×
          </button>
        </header>
        <div className="a2-noscroll min-h-0 flex-1 overflow-y-auto px-7 pb-6">
          {evs.length === 0 ? (
            <div className={`${F.pix} py-10 text-center text-[28px]`} style={{ color: K.muted }}>
              A free day. Baumy suggests a nap.
            </div>
          ) : (
            evs.map((e, i) => {
              const h = HM[e.who];
              return (
                <div
                  key={e.start + e.title}
                  className="flex items-center gap-4 py-4"
                  style={{ borderTop: i === 0 ? undefined : `2px solid ${K.line}`, opacity: past ? 0.6 : 1 }}
                >
                  <div className="w-[130px] shrink-0">
                    <div className={`${F.press} text-[24px] leading-none`}>{e.start}</div>
                    <div className={`${F.silk} mt-2 text-[13px] uppercase`} style={{ color: K.muted }}>
                      {e.end === "23:59" ? "till late" : `to ${e.end}`}
                    </div>
                  </div>
                  <span className="block h-[64px] w-[8px] shrink-0" style={{ background: whoColor(e.who) }} />
                  <div className="min-w-0 flex-1">
                    <div className={`${F.pix} text-[34px] font-semibold leading-[1.05]`}>{e.title}</div>
                    <div className="mt-2 flex items-center gap-2">
                      {h && <Person id={h.id} hair={h.hair} shirt={h.shirt} scale={2} />}
                      <WhoTag who={e.who} size={15} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
      {top && <div className="flex-1" />}
    </div>
  );
}

function Month({ ym, picked, onPick }: { ym: string; picked: string | null; onPick: (iso: string | null) => void }) {
  const cells = gridFor(ym);
  const rows = cells.length / 7;
  const maxChips = rows > 5 ? 2 : 3;
  const pickedRow = picked ? Math.floor(cells.indexOf(picked) / 7) : -1;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 gap-[6px] pb-2">
        {WD.map((w, i) => (
          <div key={w} className={`${F.silk} text-center text-[14px] font-bold uppercase`} style={{ color: i >= 5 ? K.dim : K.muted }}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-[6px]" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {cells.map((iso) => {
          const inMonth = monthOf(iso) === ym;
          const isToday = iso === TODAY_ISO;
          const past = iso < TODAY_ISO;
          const evs = eventsOn(iso);
          const shown = evs.slice(0, evs.length > maxChips ? maxChips - 1 : maxChips);
          const extra = evs.length - shown.length;
          const on = picked === iso;
          const frame: CSSProperties = isToday
            ? framed(K.violet, "#241741", 3)
            : on
              ? framed(K.text, K.raised, 3)
              : { background: inMonth ? K.surface : "transparent", ...notch(3), boxShadow: inMonth ? undefined : `inset 0 0 0 2px ${K.line}` };
          return (
            <button
              key={iso}
              type="button"
              data-date={iso}
              onClick={() => onPick(iso)}
              className="flex min-h-0 flex-col gap-[4px] overflow-hidden p-[7px] text-left"
              style={{ ...frame, opacity: inMonth ? 1 : 0.4 }}
            >
              <div className="flex h-[24px] items-center justify-between">
                <span
                  className={`${F.press} px-[4px] text-[15px] leading-[22px]`}
                  style={
                    isToday
                      ? { background: K.violet, color: K.ink }
                      : { color: past ? K.dim : dow(iso) >= 5 ? K.muted : K.text }
                  }
                >
                  {dom(iso)}
                </span>
                {isToday && (
                  <span className={`${F.silk} text-[11px] font-bold uppercase`} style={{ color: K.violet }}>
                    today
                  </span>
                )}
              </div>
              {shown.map((e) => (
                <Chip key={e.start + e.title} e={e} dim={past} />
              ))}
              {extra > 0 && (
                <div className={`${F.press} pl-[2px] text-[13px] leading-[20px]`} style={{ color: K.muted }}>
                  +{extra} more
                </div>
              )}
            </button>
          );
        })}
      </div>
      {picked && <DaySheet iso={picked} top={pickedRow >= rows / 2} onClose={() => onPick(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- area
export function CalendarArea({ today }: { today: ReactNode }) {
  const [view, setView] = useState<View>("week");
  const [ym, setYm] = useState(monthOf(TODAY_ISO));
  const [picked, setPicked] = useState<string | null>(null);
  const firstYm = monthOf(MONTH_EVENTS[0]!.date);
  const lastYm = monthOf(MONTH_EVENTS[MONTH_EVENTS.length - 1]!.date);
  const pick = (v: View) => {
    setView(v);
    setPicked(null);
    if (v === "month") setYm(monthOf(TODAY_ISO));
  };
  return (
    <div className="flex h-full flex-col gap-4">
      <style>{A2_CSS}</style>
      <div className="flex h-[68px] shrink-0 items-center justify-between gap-4">
        {view === "week" ? (
          <div className="flex items-baseline gap-4 pl-1">
            <span className={`${F.press} text-[22px]`} style={{ color: K.text }}>
              AGENDA
            </span>
            <span className={`${F.silk} text-[15px] font-bold uppercase`} style={{ color: K.muted }}>
              next 3 weeks
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <ArrowBtn
              dir={-1}
              label="Previous month"
              onClick={() => {
                setPicked(null);
                setYm((y) => (y > firstYm ? addMonths(y, -1) : y));
              }}
            />
            <span className={`${F.press} w-[252px] text-center text-[20px] leading-none`} style={{ color: K.text }}>
              {monName(`${ym}-01`).toUpperCase()}
            </span>
            <ArrowBtn
              dir={1}
              label="Next month"
              onClick={() => {
                setPicked(null);
                setYm((y) => (y < lastYm ? addMonths(y, 1) : y));
              }}
            />
          </div>
        )}
        <ViewToggle view={view} onPick={pick} />
      </div>
      {view === "week" ? (
        <>
          {today}
          <Agenda />
        </>
      ) : (
        <Month ym={ym} picked={picked} onPick={setPicked} />
      )}
    </div>
  );
}
