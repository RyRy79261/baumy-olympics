// PROTOTYPE (issue #7), throwaway. Variant C ("Busy"): the home view pieces,
// menubar, ticker, status desktop, calendar window, side widgets, taskbar.

import { BaumySprite } from "./baumy-sprite";
import {
  BOUNTIES,
  HOUSEMATES,
  isUrgent,
  LAST_EVENT,
  MESSAGES,
  METRICS,
  POT,
  REMINDER,
  WEEK,
  type Taxonomy,
} from "./data";
import { bevel, C, fmtDue, font, HM, taxColor, whoColor, whoName, Win } from "./variant-c-chrome";
import { CoinStacks, Glyph, Person, type GlyphName } from "./variant-c-pixels";

export type Filter = { status: "all" | "new" | "urgent" | "overdue"; tax: "all" | Taxonomy };

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---------------------------------------------------------------- menubar
export function MenuBar({ now }: { now: Date }) {
  const urgent = BOUNTIES.filter(isUrgent).length;
  return (
    <div
      className="relative z-10 flex h-[48px] items-center gap-3 px-3"
      style={{ background: C.chrome, boxShadow: `inset 0 -2px 0 ${C.lo}, inset 0 2px 0 ${C.hi}` }}
    >
      <div className="flex items-center gap-2 pr-2" style={{ borderRight: `2px solid ${C.lo}` }}>
        <BaumySprite scale={1.3} />
        <span className={`${font.press} text-[13px]`} style={{ color: C.amber, textShadow: `2px 2px 0 ${C.lo}` }}>
          BAUMY<span style={{ color: C.pink }}>OS</span>
        </span>
      </div>
      <div className={`${font.silk} flex gap-3 text-[12px] uppercase`} style={{ color: C.muted }}>
        <span>
          <u>F</u>ile
        </span>
        <span>
          <u>C</u>hores
        </span>
        <span>
          <u>H</u>ouse
        </span>
      </div>
      <span className="flex-1" />
      {/* house "weather" */}
      <div
        className="flex h-[36px] items-center gap-2 px-2"
        style={{ background: C.panel, ...bevel(false) }}
      >
        <Glyph name="cloud" size={24} color={C.violet} accent={C.teal} />
        <div className="leading-none">
          <div className={`${font.silk} text-[10px] uppercase`} style={{ color: C.muted }}>
            house weather
          </div>
          <div className={`${font.silk} text-[13px] font-bold uppercase`} style={{ color: C.text }}>
            Drizzly · <span style={{ color: C.red }}>{METRICS.overdue} late</span> ·{" "}
            <span style={{ color: C.amber }}>{urgent} urgent</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {[C.green, C.teal, C.amber, C.red].map((c, i) => (
          <span
            key={c}
            className={i === 3 ? "vc-blink block size-[8px]" : "vc-led block size-[8px]"}
            style={{ background: c, boxShadow: `0 0 6px ${c}`, animationDelay: `${i * 0.7}s` }}
          />
        ))}
      </div>
      <div
        className="flex h-[38px] items-center gap-2 px-2"
        style={{ background: C.ink, ...bevel(false) }}
      >
        <span className={`${font.press} text-[22px]`} style={{ color: C.amber, textShadow: `0 0 8px ${C.amber}66` }}>
          {hhmm(now)}
        </span>
        <span className={`${font.silk} text-[11px] font-bold uppercase leading-[1.05]`} style={{ color: C.text }}>
          Mon
          <br />
          28 Sep
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ticker
export function Ticker() {
  const items: { c: string; t: string }[] = [
    { c: C.yellow, t: `★ ${LAST_EVENT.text} +${LAST_EVENT.bonus} BONUS ★` },
    ...MESSAGES.map((m) => ({ c: whoColor(m.who), t: `${whoName(m.who).toUpperCase()}: ${m.text}` })),
    { c: C.red, t: `!! ${REMINDER.title}` },
    { c: C.teal, t: `HOUSE STREAK ${METRICS.houseStreakDays} DAYS` },
    { c: C.amber, t: `POT €${POT.euros.toFixed(2)}` },
  ];
  const row = (k: string) => (
    <div key={k} className="flex shrink-0 items-center gap-6 pr-6">
      {items.map((it) => (
        <span key={it.t} className="flex items-center gap-2 whitespace-nowrap">
          <span className="block size-[8px]" style={{ background: it.c }} />
          <span style={{ color: it.c }}>{it.t}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div
      className="relative flex h-[30px] items-center overflow-hidden"
      style={{ background: C.ink, borderBottom: `2px solid ${C.lo}` }}
    >
      <div
        className={`${font.silk} z-10 flex h-full shrink-0 items-center gap-1 px-2 text-[12px] font-bold`}
        style={{ background: C.red, color: C.ink }}
      >
        <span className="vc-blink">●</span> LIVE
      </div>
      <div className={`${font.vt} vc-marquee flex text-[21px] leading-none`}>
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- fairy lights
export function FairyLights() {
  const cols = [C.violet, C.teal, C.pink, C.yellow, C.amber];
  return (
    <div className="pointer-events-none relative h-[18px]">
      <svg width="820" height="18" className="absolute inset-0" aria-hidden>
        <path d="M0 3 Q 102 16 205 4 T 410 4 T 615 4 T 820 3" fill="none" stroke="#07040c" strokeWidth="2" />
      </svg>
      {Array.from({ length: 28 }, (_, i) => {
        const x = 12 + Math.round(i * 29.5);
        const phase = ((x % 205) / 205) * Math.PI;
        const y = Math.round(4 + Math.sin(phase) * 8);
        const c = cols[i % cols.length]!;
        return (
          <span
            key={i}
            className="vc-bulb absolute block h-[7px] w-[5px]"
            style={{
              left: x,
              top: y,
              background: c,
              boxShadow: `0 0 8px 2px ${c}88`,
              animationDelay: `${(i % 4) * 0.45}s`,
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- status desktop
function Sparkles() {
  return (
    <>
      {[
        { l: -6, t: -6, d: "0s", s: 16 },
        { l: 58, t: 2, d: "0.5s", s: 12 },
        { l: 50, t: 56, d: "0.9s", s: 14 },
      ].map((p) => (
        <span key={p.d} className="vc-sparkle absolute" style={{ left: p.l, top: p.t, animationDelay: p.d }}>
          <Glyph name="sparkle" size={p.s} color={C.yellow} />
        </span>
      ))}
    </>
  );
}

function BountyTile({
  kind,
  tax,
  onOpen,
}: {
  kind: "new" | "urgent";
  tax: Taxonomy;
  onOpen: (f: Filter) => void;
}) {
  const list = BOUNTIES.filter((b) => b.taxonomy === tax && (kind === "new" ? b.isNew : isUrgent(b)));
  const soonest = list.reduce((m, b) => Math.min(m, b.dueInHours), Infinity);
  const tc = taxColor(tax);
  const urgent = kind === "urgent";
  const pts = list.reduce((s, b) => s + b.reward, 0);
  return (
    <button
      type="button"
      onClick={() => onOpen({ status: kind, tax })}
      data-tile={`${kind}-${tax}`}
      className="relative flex h-[136px] flex-col p-2 text-left active:translate-y-[2px]"
      style={{ background: urgent ? "#2a1128" : C.panel, ...bevel() }}
    >
      {urgent && (
        <span
          className="vc-flag absolute right-0 top-0 block size-0"
          style={{ borderTop: `30px solid ${C.red}`, borderLeft: "30px solid transparent" }}
        />
      )}
      <div className="flex items-start gap-2">
        <div
          className="relative grid size-[70px] shrink-0 place-items-center"
          style={{ background: `${tc}1f`, ...bevel(false) }}
        >
          <Glyph name={tax === "consumables" ? "cart" : "wrench"} size={48} color={tc} />
          <span className="absolute -bottom-1 -right-1">
            <Glyph name={urgent ? "alarm" : "sparkle"} size={24} color={urgent ? C.red : C.yellow} />
          </span>
          {!urgent && <Sparkles />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-end">
          <span
            className={`${font.press} text-[38px] leading-[1]`}
            style={{ color: urgent ? C.red : C.yellow, textShadow: `3px 3px 0 ${C.lo}` }}
          >
            {list.length}
          </span>
          {urgent ? (
            <span
              className={`${font.press} vc-pulse mt-2 px-1 py-[3px] text-[13px]`}
              style={{ background: soonest < 0 ? C.red : C.amber, color: C.ink }}
            >
              {fmtDue(soonest)}
            </span>
          ) : (
            <span className={`${font.press} mt-2 px-1 py-[3px] text-[11px]`} style={{ background: C.yellow, color: C.ink }}>
              NEW
            </span>
          )}
          <span className={`${font.silk} mt-1 text-[11px]`} style={{ color: C.muted }}>
            +{pts} pts
          </span>
        </div>
      </div>
      <span className="flex-1" />
      <div
        className={`${font.silk} flex h-[24px] items-center gap-1.5 px-1.5 text-[12px] font-bold uppercase`}
        style={{ background: tc, color: C.ink }}
      >
        <span className="block size-[7px]" style={{ background: urgent ? C.red : C.ink }} />
        {tax === "consumables" ? "supplies" : "chores"}
      </div>
    </button>
  );
}

function StatTile({
  glyph,
  color,
  value,
  unit,
  label,
  onOpen,
  extra,
  big = true,
}: {
  glyph: GlyphName;
  color: string;
  value: string;
  unit?: string;
  label: string;
  onOpen?: () => void;
  extra?: React.ReactNode;
  big?: boolean;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <div className="grid size-[46px] shrink-0 place-items-center" style={{ background: `${color}1f`, ...bevel(false) }}>
          <Glyph name={glyph} size={32} color={color} />
        </div>
        <div className="min-w-0 flex-1 text-right leading-none">
          <span className={`${font.press} ${big ? "text-[22px]" : "text-[17px]"}`} style={{ color, textShadow: `2px 2px 0 ${C.lo}` }}>
            {value}
          </span>
          {unit && (
            <span className={`${font.silk} ml-0.5 text-[12px]`} style={{ color: C.muted }}>
              {unit}
            </span>
          )}
        </div>
      </div>
      <div className={`${font.silk} mt-1.5 flex items-center justify-between text-[11px] font-bold uppercase`} style={{ color: C.muted }}>
        <span>{label}</span>
        {extra}
      </div>
    </>
  );
  const cls = "relative flex h-[84px] flex-col justify-center p-2 text-left";
  return onOpen ? (
    <button type="button" onClick={onOpen} className={`${cls} active:translate-y-[2px]`} style={{ background: C.panel, ...bevel() }}>
      {inner}
    </button>
  ) : (
    <div className={cls} style={{ background: C.panel, ...bevel() }}>
      {inner}
    </div>
  );
}

export function StatusDesktop({ onOpen }: { onOpen: (f: Filter) => void }) {
  const overdue = BOUNTIES.filter((b) => b.dueInHours < 0);
  const leader = [...HOUSEMATES].sort((a, b) => b.points - a.points)[0]!;
  return (
    <div className="px-3">
      <div className="grid grid-cols-5 gap-[10px]">
        <BountyTile kind="new" tax="consumables" onOpen={onOpen} />
        <BountyTile kind="urgent" tax="consumables" onOpen={onOpen} />
        <BountyTile kind="new" tax="maintenance" onOpen={onOpen} />
        <BountyTile kind="urgent" tax="maintenance" onOpen={onOpen} />
        <button
          type="button"
          onClick={() => onOpen({ status: "overdue", tax: "all" })}
          data-tile="overdue"
          className="relative flex h-[136px] flex-col items-center justify-center gap-1 p-2 active:translate-y-[2px]"
          style={{
            background: `repeating-linear-gradient(135deg, #3a0f1f 0 10px, #2a0b18 10px 20px)`,
            ...bevel(),
          }}
        >
          <span
            className="vc-flag absolute right-0 top-0 block size-0"
            style={{ borderTop: `30px solid ${C.red}`, borderLeft: "30px solid transparent" }}
          />
          <Glyph name="hourglass" size={46} color={C.red} accent={C.amber} />
          <span className={`${font.press} text-[38px] leading-none`} style={{ color: C.red, textShadow: `3px 3px 0 ${C.lo}` }}>
            {overdue.length}
          </span>
          <span className={`${font.silk} px-1.5 text-[12px] font-bold uppercase`} style={{ background: C.red, color: C.ink }}>
            overdue
          </span>
        </button>
      </div>
      <div className="mt-[10px] grid grid-cols-5 gap-[10px]">
        <StatTile
          glyph="coin"
          color={C.yellow}
          value={`€${Math.round(POT.euros)}`}
          label="the pot"
          extra={<span style={{ color: C.dim }}>{POT.daysLeft}d</span>}
        />
        <StatTile
          glyph="flame"
          color={C.amber}
          value={String(METRICS.houseStreakDays)}
          unit="d"
          label="house streak"
        />
        <StatTile
          glyph="crown"
          color={leader.color}
          value={leader.name.toUpperCase()}
          label="leader"
          big={false}
          extra={<span style={{ color: C.dim }}>{leader.points}</span>}
        />
        <StatTile glyph="check" color={C.green} value={String(METRICS.doneThisWeek)} label="done / 7d" extra={<span style={{ color: C.green }}>▲4</span>} />
        <StatTile
          glyph="board"
          color={C.pink}
          value={String(BOUNTIES.length)}
          label="all bounties"
          onOpen={() => onOpen({ status: "all", tax: "all" })}
          extra={<span style={{ color: C.pink }}>▶</span>}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- calendar
const DAYS = [
  { d: "MON", n: 28 },
  { d: "TUE", n: 29 },
  { d: "WED", n: 30 },
  { d: "THU", n: 1 },
  { d: "FRI", n: 2 },
  { d: "SAT", n: 3 },
  { d: "SUN", n: 4 },
];
const mins = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
};
const H0 = 15;
const H1 = 24;

function WeekStrip() {
  return (
    <div className="grid grid-cols-7 gap-[4px] p-[6px]" style={{ background: C.ink }}>
      {DAYS.map((day, i) => {
        const today = i === 0;
        const evs = WEEK.filter((e) => e.day === i);
        return (
          <div
            key={day.d}
            className="flex h-[172px] flex-col"
            style={{
              background: today ? "#3a1430" : C.panel,
              boxShadow: today ? `0 0 0 2px ${C.amber}` : `0 0 0 1px ${C.chrome}`,
            }}
          >
            <div
              className="flex items-baseline justify-between px-1 py-[2px]"
              style={{ background: today ? C.amber : C.chrome, color: today ? C.ink : C.muted }}
            >
              <span className={`${font.silk} text-[11px] font-bold`}>{day.d}</span>
              <span className={`${font.press} text-[12px]`}>{day.n}</span>
            </div>
            <div className="flex flex-1 flex-col gap-[3px] p-[3px]">
              {evs.map((e) => (
                <div
                  key={e.title}
                  className="overflow-hidden px-[3px] py-[1px]"
                  style={{ background: `${whoColor(e.who)}26`, borderLeft: `4px solid ${whoColor(e.who)}` }}
                >
                  <div className={`${font.vt} text-[15px] leading-[0.95]`} style={{ color: whoColor(e.who) }}>
                    {e.start}
                  </div>
                  <div className={`${font.vt} line-clamp-3 text-[16px] leading-[0.9]`} style={{ color: C.text }}>
                    {e.title}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TodayTimeline({ now }: { now: Date }) {
  const H = 440;
  const pxPerMin = H / ((H1 - H0) * 60);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowY = (nowMin - H0 * 60) * pxPerMin;
  const all = WEEK.filter((e) => e.day === 0);
  const earlier = all.filter((e) => mins(e.end) <= H0 * 60);
  const evs = all.filter((e) => mins(e.end) > H0 * 60);
  // two lanes for overlaps
  const lanes: { end: number }[] = [];
  const placed = evs.map((e) => {
    const s = mins(e.start);
    const en = mins(e.end);
    let lane = lanes.findIndex((l) => l.end <= s);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push({ end: en });
    } else lanes[lane] = { end: en };
    return { e, s, en, lane };
  });
  const laneCount = Math.max(1, lanes.length);
  return (
    <div className="relative" style={{ height: H }}>
      {/* past hatch */}
      <div
        className="absolute left-[40px] right-0 top-0"
        style={{
          height: Math.max(0, nowY),
          background: "repeating-linear-gradient(135deg, #ffffff08 0 4px, transparent 4px 9px)",
        }}
      />
      {Array.from({ length: H1 - H0 + 1 }, (_, i) => {
        const y = i * 60 * pxPerMin;
        const hr = H0 + i;
        return (
          <div key={hr} className="absolute left-0 right-0" style={{ top: y }}>
            <div className="absolute left-[40px] right-0 h-px" style={{ background: hr % 3 === 0 ? C.chrome : "#2a1d3d" }} />
            {i < H1 - H0 && (
              <span
                className={`${font.vt} absolute left-0 top-[-8px] w-[36px] text-right text-[16px] leading-none`}
                style={{ color: hr % 3 === 0 ? C.muted : C.dim }}
              >
                {pad(hr)}
              </span>
            )}
          </div>
        );
      })}
      {placed.map(({ e, s, en, lane }) => {
        const top = (s - H0 * 60) * pxPerMin;
        const h = Math.max(24, (en - s) * pxPerMin);
        const c = whoColor(e.who);
        const past = en <= nowMin;
        const w = `calc((100% - 46px) / ${laneCount})`;
        return (
          <div
            key={e.title}
            className="absolute overflow-hidden px-1.5 py-1"
            style={{
              top,
              height: h,
              left: `calc(44px + ${lane} * (100% - 46px) / ${laneCount})`,
              width: w,
              background: past ? `${c}22` : `${c}40`,
              borderLeft: `5px solid ${c}`,
              boxShadow: `inset 0 0 0 1px ${c}88, 2px 2px 0 ${C.lo}`,
              opacity: past ? 0.55 : 1,
            }}
          >
            <div className="flex items-center gap-1">
              {e.who !== "house" ? (
                <Person id={e.who} hair={HM[e.who]!.hair} shirt={HM[e.who]!.shirt} scale={1} />
              ) : (
                <Glyph name="home" size={12} color={c} shadow={false} />
              )}
              <span className={`${font.silk} truncate text-[11px] font-bold uppercase`} style={{ color: c }}>
                {e.start}–{e.end}
              </span>
            </div>
            <div className={`${font.pix} text-[19px] font-semibold leading-[1.05]`} style={{ color: C.text }}>
              {e.title}
            </div>
          </div>
        );
      })}
      {earlier.length > 0 && (
        <div
          className={`${font.silk} absolute left-[44px] right-0 top-[4px] flex items-center gap-2 px-1.5 py-[2px] text-[11px] font-bold uppercase`}
          style={{ background: C.ink, color: C.dim, boxShadow: `inset 0 0 0 1px ${C.chrome}` }}
        >
          <Glyph name="check" size={11} color={C.green} shadow={false} />
          earlier: {earlier.map((e) => `${e.start} ${e.title}`).join(" · ")}
        </div>
      )}
      {/* now line */}
      <div className="absolute left-[34px] right-0 z-10" style={{ top: nowY - 1 }}>
        <div className="vc-now h-[3px]" style={{ background: C.red }} />
        <span
          className={`${font.press} absolute -top-[9px] left-0 px-1 py-[2px] text-[9px]`}
          style={{ background: C.red, color: C.ink }}
        >
          NOW
        </span>
      </div>
    </div>
  );
}

function MiniMonth() {
  // Sep 2026 starts on a Tuesday; Mon-first grid.
  const cells: (number | null)[] = [null, ...Array.from({ length: 30 }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const busy = new Set([28, 29, 30]);
  return (
    <div className="p-1.5" style={{ background: C.ink, ...bevel(false) }}>
      <div className={`${font.silk} mb-1 flex justify-between text-[11px] font-bold`} style={{ color: C.amber }}>
        <span>◀</span>
        <span>SEP 2026</span>
        <span>▶</span>
      </div>
      <div className={`${font.vt} grid grid-cols-7 text-center text-[14px] leading-[15px]`}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} style={{ color: C.dim }}>
            {d}
          </span>
        ))}
        {cells.map((n, i) => (
          <span
            key={i}
            className="relative"
            style={{
              color: n === 28 ? C.ink : n && n >= 28 ? C.text : C.muted,
              background: n === 28 ? C.amber : n && n >= 28 ? "#3a1430" : undefined,
            }}
          >
            {n ?? ""}
            {n && busy.has(n) && n !== 28 && (
              <span className="absolute bottom-0 left-1/2 block size-[2px] -translate-x-1/2" style={{ background: C.pink }} />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CalendarWin({ now }: { now: Date }) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const next = WEEK.filter((e) => e.day === 0 && mins(e.start) > nowMin).sort((a, b) => mins(a.start) - mins(b.start))[0];
  const inMin = next ? mins(next.start) - nowMin : 0;
  const tomorrow = WEEK.filter((e) => e.day === 1);
  return (
    <Win title="calendar.exe — week 40" glyph="calendar" led={C.amber} className="h-full" bodyClass="flex flex-col">
      {/* legend toolbar */}
      <div
        className={`${font.silk} flex h-[24px] items-center gap-3 px-2 text-[11px] font-bold uppercase`}
        style={{ background: C.chrome, borderBottom: `2px solid ${C.lo}`, color: C.muted }}
      >
        {[...HOUSEMATES.map((h) => ({ id: h.id, n: h.name, c: h.color })), { id: "house", n: "House", c: C.amber }].map((h) => (
          <span key={h.id} className="flex items-center gap-1">
            <span className="block size-[9px]" style={{ background: h.c, boxShadow: `1px 1px 0 ${C.lo}` }} />
            {h.n}
          </span>
        ))}
        <span className="flex-1" />
        <span style={{ color: C.dim }}>{WEEK.length} events</span>
      </div>
      <WeekStrip />
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-1 flex items-baseline gap-2">
            <span className={`${font.press} text-[20px]`} style={{ color: C.amber, textShadow: `2px 2px 0 ${C.lo}` }}>
              TODAY
            </span>
            <span className={`${font.silk} text-[13px] font-bold uppercase`} style={{ color: C.text }}>
              Mon 28 Sep
            </span>
          </div>
          <TodayTimeline now={now} />
        </div>
        <div className="flex w-[146px] shrink-0 flex-col gap-2">
          <MiniMonth />
          {next && (
            <div className="p-2" style={{ background: `${whoColor(next.who)}22`, ...bevel(false) }}>
              <div className={`${font.silk} text-[11px] font-bold uppercase`} style={{ color: C.muted }}>
                up next
              </div>
              <div className={`${font.press} mt-1 text-[20px]`} style={{ color: whoColor(next.who) }}>
                {inMin >= 60 ? `${Math.floor(inMin / 60)}h${pad(inMin % 60)}` : `${inMin}m`}
              </div>
              <div className={`${font.pix} text-[17px] font-semibold leading-tight`} style={{ color: C.text }}>
                {next.title}
              </div>
              <div className={`${font.vt} text-[16px]`} style={{ color: C.muted }}>
                {next.start} · {whoName(next.who)}
              </div>
            </div>
          )}
          <div className="flex-1 p-2" style={{ background: C.ink, ...bevel(false) }}>
            <div className={`${font.silk} text-[11px] font-bold uppercase`} style={{ color: C.muted }}>
              tomorrow
            </div>
            {tomorrow.map((e) => (
              <div key={e.title} className="mt-1.5 pl-1.5" style={{ borderLeft: `3px solid ${whoColor(e.who)}` }}>
                <div className={`${font.vt} text-[15px] leading-none`} style={{ color: whoColor(e.who) }}>
                  {e.start}
                </div>
                <div className={`${font.pix} text-[15px] leading-tight`} style={{ color: C.text }}>
                  {e.title}
                </div>
              </div>
            ))}
            <div className="mt-3 flex items-center gap-1.5 p-1" style={{ background: "#3a0f1f" }}>
              <Glyph name="pin" size={14} color={C.red} accent={C.pink} />
              <span className={`${font.silk} text-[10px] font-bold uppercase leading-tight`} style={{ color: C.pink }}>
                Wed: be home 10–16
              </span>
            </div>
          </div>
        </div>
      </div>
    </Win>
  );
}

// ---------------------------------------------------------------- side widgets
export function Leaderboard() {
  const ranked = [...HOUSEMATES].sort((a, b) => b.points - a.points);
  const max = ranked[0]!.points;
  return (
    <Win title="scores.exe" glyph="trophy" led={C.yellow}>
      <div className="flex flex-col gap-[6px] p-2">
        {ranked.map((h, i) => (
          <div key={h.id} className="flex items-center gap-2">
            <span className={`${font.press} w-[18px] text-[16px]`} style={{ color: i === 0 ? C.yellow : C.dim }}>
              {i + 1}
            </span>
            <div className="relative grid h-[46px] w-[38px] place-items-end justify-center" style={{ background: `${h.color}22`, ...bevel(false) }}>
              <Person id={h.id} hair={h.hair} shirt={h.shirt} scale={2.5} className={i === 0 ? "vc-bob" : ""} />
              {i === 0 && (
                <span className="absolute -top-[12px] left-1/2 -translate-x-1/2">
                  <Glyph name="crown" size={16} color={C.yellow} />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between">
                <span className={`${font.silk} text-[13px] font-bold uppercase`} style={{ color: h.color }}>
                  {h.name}
                </span>
                <span className={`${font.press} text-[12px]`} style={{ color: C.text }}>
                  {h.points}
                </span>
              </div>
              <div className="mt-1 h-[10px]" style={{ background: C.ink, boxShadow: `inset 0 0 0 1px ${C.chrome}` }}>
                <div
                  className="h-full"
                  style={{
                    width: `${(h.points / max) * 100}%`,
                    background: `repeating-linear-gradient(90deg, ${h.color} 0 6px, ${h.color}aa 6px 8px)`,
                  }}
                />
              </div>
              <div className={`${font.vt} mt-[1px] flex items-center gap-1 text-[14px] leading-none`} style={{ color: C.muted }}>
                {h.streak > 0 ? (
                  <>
                    <Glyph name="flame" size={10} color={C.amber} shadow={false} /> {h.streak}× streak
                  </>
                ) : (
                  <span style={{ color: C.dim }}>no streak</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Win>
  );
}

export function PotWin() {
  const pct = ((365 - POT.daysLeft) / 365) * 100;
  return (
    <Win title="pot.sav" glyph="coin" led={C.amber}>
      <div className="flex items-end gap-2 p-2">
        <CoinStacks heights={[3, 5, 4]} scale={2} />
        <div className="flex-1 text-right">
          <div className={`${font.press} text-[21px]`} style={{ color: C.yellow, textShadow: `2px 2px 0 ${C.lo}` }}>
            €{POT.euros.toFixed(0)}
            <span className="text-[12px]">.{POT.euros.toFixed(2).split(".")[1]}</span>
          </div>
          <div className={`${font.silk} text-[11px] uppercase`} style={{ color: C.muted }}>
            season {POT.season}
          </div>
        </div>
      </div>
      <div className="px-2 pb-2">
        <div className="h-[10px]" style={{ background: C.ink, boxShadow: `inset 0 0 0 1px ${C.chrome}` }}>
          <div className="h-full" style={{ width: `${pct}%`, background: `repeating-linear-gradient(90deg, ${C.amber} 0 5px, ${C.wine} 5px 7px)` }} />
        </div>
        <div className={`${font.vt} flex justify-between text-[14px] leading-none`} style={{ color: C.muted }}>
          <span>payout in</span>
          <span style={{ color: C.amber }}>{POT.daysLeft} days</span>
        </div>
      </div>
    </Win>
  );
}

const DONE_PER_DAY = [
  { d: "T", n: 4 },
  { d: "W", n: 2 },
  { d: "T", n: 5 },
  { d: "F", n: 3 },
  { d: "S", n: 6 },
  { d: "S", n: 1 },
  { d: "M", n: 2 },
];

export function SparkWin() {
  const max = Math.max(...DONE_PER_DAY.map((x) => x.n));
  const W = 226;
  const Hh = 44;
  const pts = DONE_PER_DAY.map((x, i) => `${(i + 0.5) * (W / 7)},${Hh - (x.n / max) * (Hh - 6)}`).join(" ");
  return (
    <Win title="done.log" glyph="check" led={C.green}>
      <div className="p-2">
        <div className="flex items-baseline justify-between">
          <span className={`${font.press} text-[18px]`} style={{ color: C.green }}>
            {METRICS.doneThisWeek}
          </span>
          <span className={`${font.silk} text-[11px] uppercase`} style={{ color: C.muted }}>
            done · last 7 days
          </span>
        </div>
        <div className="relative mt-1" style={{ height: Hh, width: W }}>
          <div className="absolute inset-0 flex items-end">
            {DONE_PER_DAY.map((x, i) => (
              <div key={i} className="flex flex-1 justify-center">
                <div
                  className="w-[18px]"
                  style={{
                    height: `${(x.n / max) * (Hh - 6)}px`,
                    background: i === 6 ? C.amber : `${C.green}55`,
                    boxShadow: `inset 0 2px 0 ${i === 6 ? C.amberLt : C.green}`,
                  }}
                />
              </div>
            ))}
          </div>
          <svg width={W} height={Hh} className="absolute inset-0" aria-hidden shapeRendering="crispEdges">
            <polyline points={pts} fill="none" stroke={C.green} strokeWidth="2" strokeLinejoin="miter" />
          </svg>
        </div>
        <div className={`${font.vt} flex text-[14px] leading-none`} style={{ color: C.dim }}>
          {DONE_PER_DAY.map((x, i) => (
            <span key={i} className="flex-1 text-center" style={{ color: i === 6 ? C.amber : undefined }}>
              {x.d}
            </span>
          ))}
        </div>
      </div>
    </Win>
  );
}

export function BoardWin() {
  return (
    <Win title="board.txt" glyph="msg" led={C.pink} className="min-h-0 flex-1" bodyClass="overflow-hidden">
      <div className="flex flex-col gap-1.5 p-2">
        {MESSAGES.map((m) => (
          <div key={m.text} className="flex gap-1.5">
            <div className="shrink-0" style={{ ...bevel(false), background: `${whoColor(m.who)}22` }}>
              <Person id={m.who} hair={HM[m.who]!.hair} shirt={HM[m.who]!.shirt} scale={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`${font.silk} flex justify-between text-[10px] font-bold uppercase`} style={{ color: whoColor(m.who) }}>
                <span>{whoName(m.who)}</span>
                <span style={{ color: C.dim }}>{m.ago}</span>
              </div>
              <div className={`${font.vt} text-[16px] leading-[0.95]`} style={{ color: C.text }}>
                {m.text}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Win>
  );
}

// ---------------------------------------------------------------- taskbar
const TABS: { id: string; label: string; glyph: GlyphName; badge?: number }[] = [
  { id: "home", label: "Home", glyph: "home" },
  { id: "bounties", label: "Bounties", glyph: "board", badge: BOUNTIES.filter(isUrgent).length },
  { id: "calendar", label: "Calendar", glyph: "calendar" },
  { id: "board", label: "Board", glyph: "msg", badge: MESSAGES.length },
  { id: "shop", label: "Shop", glyph: "shop" },
  { id: "scores", label: "Scores", glyph: "trophy" },
];

export function Taskbar({
  now,
  listening,
  onVoice,
  onTab,
}: {
  now: Date;
  listening: boolean;
  onVoice: () => void;
  onTab: (id: string) => void;
}) {
  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-20 flex h-[78px] items-center gap-2 pl-[176px] pr-3"
      style={{ background: C.chrome, boxShadow: `inset 0 2px 0 ${C.hi}, 0 -2px 0 ${C.lo}` }}
    >
      {/* Start button = Baumy voice */}
      <button
        type="button"
        onClick={onVoice}
        data-voice
        aria-label={listening ? "Stop listening" : "Talk to Baumy"}
        className="absolute bottom-[6px] left-[10px] h-[118px] w-[156px] active:translate-y-[2px]"
        style={{
          background: listening
            ? `linear-gradient(180deg, ${C.red} 0%, ${C.wine} 100%)`
            : `linear-gradient(180deg, ${C.amber} 0%, #d9722b 100%)`,
          boxShadow: `0 0 0 3px ${C.lo}, inset 3px 3px 0 ${listening ? "#ff9aa4" : C.amberLt}, inset -3px -3px 0 ${listening ? "#4a1027" : "#9a4a17"}, 0 0 22px ${listening ? C.red : C.amber}88`,
        }}
      >
        <span className="absolute left-[8px] top-[8px] flex flex-col items-start gap-1">
          <Glyph name="mic" size={28} color={C.ink} accent={listening ? C.text : C.wine} shadow={false} />
          <span className={`${font.press} text-[12px] leading-tight`} style={{ color: C.ink }}>
            {listening ? "STOP" : "TALK"}
          </span>
        </span>
        <span className={`absolute bottom-[6px] right-[6px] ${listening ? "vc-hop" : "vc-bob"}`}>
          <BaumySprite scale={3} />
        </span>
      </button>
      {TABS.map((t, i) => {
        const active = i === 0;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            className="relative flex h-[62px] w-[70px] flex-col items-center justify-center gap-1"
            style={{ background: active ? C.ink : C.panel, ...bevel(!active) }}
          >
            <Glyph name={t.glyph} size={24} color={active ? C.amber : C.muted} />
            <span className={`${font.silk} text-[10px] font-bold uppercase`} style={{ color: active ? C.amber : C.muted }}>
              {t.label}
            </span>
            {t.badge ? (
              <span
                className={`${font.press} absolute -right-1 -top-1 grid h-[16px] min-w-[16px] place-items-center px-[2px] text-[9px]`}
                style={{ background: C.red, color: C.text, boxShadow: `0 0 0 2px ${C.lo}` }}
              >
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
      <span className="flex-1" />
      <div className="flex h-[52px] flex-col justify-center gap-1 px-2" style={{ background: C.ink, ...bevel(false) }}>
        <div className="flex items-center gap-1.5">
          <Glyph name="bolt" size={12} color={C.yellow} shadow={false} />
          <Glyph name="heart" size={12} color={C.pink} shadow={false} />
          <span className="vc-led block size-[7px]" style={{ background: C.green, boxShadow: `0 0 5px ${C.green}` }} />
          <span className={`${font.silk} text-[10px]`} style={{ color: C.muted }}>
            SYNC
          </span>
        </div>
        <span className={`${font.press} text-[13px]`} style={{ color: C.text }}>
          {hhmm(now)}
          <span className="vc-blink" style={{ color: C.amber }}>
            :
          </span>
          {pad(now.getSeconds())}
        </span>
      </div>
    </div>
  );
}
