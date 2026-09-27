// PROTOTYPE (issue #7), throwaway. Shared by the overlays: window chrome,
// colours, helpers and keyframes for the retro-OS lounge.

import type { CSSProperties, ReactNode } from "react";
import { HOUSEMATES, type Bounty } from "./data";
import { Glyph, type GlyphName } from "./pixels";

export const C = {
  bg: "#140c1f",
  desk: "#1b1029",
  panel: "#1f1430",
  chrome: "#2e1e47",
  hi: "#6d4f96",
  lo: "#07040c",
  ink: "#0b0712",
  wine: "#7a1f3d",
  wineDk: "#4a1027",
  amber: "#ffb347",
  amberLt: "#ffd89a",
  text: "#f7ecff",
  muted: "#ab9cc8",
  dim: "#6f5f8c",
  red: "#ff4d5e",
  yellow: "#ffe46b",
  teal: "#4ff5e6",
  pink: "#ff8fc7",
  violet: "#8f7dff",
  green: "#43f0a0",
  cons: "#ffb347",
  maint: "#4ff5e6",
} as const;

export const HM = Object.fromEntries(HOUSEMATES.map((h) => [h.id, h])) as Record<
  string,
  (typeof HOUSEMATES)[number]
>;

export const whoColor = (who: string) => (who === "house" ? C.amber : (HM[who]?.color ?? C.muted));
export const whoName = (who: string) => (who === "house" ? "House" : (HM[who]?.name ?? who));

export const taxColor = (t: Bounty["taxonomy"]) => (t === "consumables" ? C.cons : C.maint);

export function fmtDue(h: number) {
  if (h < 0) return `-${Math.abs(h)}h`;
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export const font = {
  press: "font-[family-name:var(--font-press)]",
  vt: "font-[family-name:var(--font-vt)]",
  silk: "font-[family-name:var(--font-silk)]",
  pix: "font-[family-name:var(--font-pixelify)]",
};

/** Raised bevel: light top-left, dark bottom-right, black outline. */
export const bevel = (raised = true): CSSProperties => ({
  boxShadow: raised
    ? `0 0 0 2px ${C.lo}, inset 2px 2px 0 ${C.hi}, inset -2px -2px 0 #120a1d`
    : `0 0 0 2px ${C.lo}, inset 2px 2px 0 #0a0612, inset -2px -2px 0 ${C.hi}`,
});

/** A retro-OS window with a wine title bar, a glyph and a status LED. */
export function Win({
  title,
  glyph,
  led = C.green,
  right,
  className = "",
  bodyClass = "",
  children,
  style,
}: {
  title: string;
  glyph: GlyphName;
  led?: string;
  right?: ReactNode;
  className?: string;
  bodyClass?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className={`flex flex-col ${className}`} style={{ background: C.panel, ...bevel(), ...style }}>
      <header
        className="flex h-[26px] shrink-0 items-center gap-1.5 px-1.5"
        style={{
          background: `linear-gradient(90deg, ${C.wine} 0%, #5a1838 55%, ${C.chrome} 100%)`,
          borderBottom: `2px solid ${C.lo}`,
        }}
      >
        <Glyph name={glyph} size={16} color={C.amberLt} />
        <span className={`${font.silk} truncate text-[13px] font-bold uppercase tracking-wider`} style={{ color: C.text }}>
          {title}
        </span>
        <span className="flex-1" />
        {right}
        <span className="vc-led size-[8px]" style={{ background: led, boxShadow: `0 0 6px ${led}` }} />
        {["_", "□", "×"].map((b) => (
          <span
            key={b}
            className={`${font.silk} grid size-[16px] place-items-center text-[10px] leading-none`}
            style={{ background: C.chrome, color: C.muted, ...bevel() }}
          >
            {b}
          </span>
        ))}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export const VC_CSS = `
@keyframes vc-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.vc-marquee { animation: vc-marquee 38s linear infinite; }
@keyframes vc-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.15; } }
.vc-blink { animation: vc-blink 1s steps(1) infinite; }
@keyframes vc-pulse { 0%, 49% { filter: brightness(1.25); } 50%, 100% { filter: brightness(0.8); } }
.vc-pulse { animation: vc-pulse 1s steps(1) infinite; }
.vc-blink-slow { animation: vc-blink 2.2s steps(1) infinite; }
@keyframes vc-led { 0%, 80% { opacity: 1; } 85% { opacity: 0.3; } 90%, 100% { opacity: 1; } }
.vc-led { animation: vc-led 3s steps(1) infinite; }
@keyframes vc-sparkle {
  0% { transform: scale(0.4) rotate(0deg); opacity: 0.2; }
  25% { transform: scale(1) rotate(0deg); opacity: 1; }
  50% { transform: scale(0.7) rotate(45deg); opacity: 0.8; }
  75% { transform: scale(1.1) rotate(45deg); opacity: 1; }
  100% { transform: scale(0.4) rotate(90deg); opacity: 0.2; }
}
.vc-sparkle { animation: vc-sparkle 1.4s steps(4) infinite; }
@keyframes vc-bulb { 0%, 100% { opacity: 1; filter: brightness(1.2); } 50% { opacity: 0.35; filter: brightness(0.7); } }
.vc-bulb { animation: vc-bulb 1.8s steps(2) infinite; }
@keyframes vc-frame { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.vc-frame-a { animation: vc-frame 0.32s steps(1) infinite; }
.vc-frame-b { animation: vc-frame 0.32s steps(1) infinite reverse; animation-delay: -0.16s; }
@keyframes vc-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.vc-bob { animation: vc-bob 1.2s steps(2) infinite; }
@keyframes vc-eq { 0%, 100% { transform: scaleY(0.25); } 50% { transform: scaleY(1); } }
.vc-eq { animation: vc-eq 0.6s steps(3) infinite; transform-origin: bottom; }
@keyframes vc-pop { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.vc-pop { animation: vc-pop 0.18s steps(3) both; }
@keyframes vc-now { 0%, 100% { box-shadow: 0 0 0 0 #ff4d5e; } 50% { box-shadow: 0 0 10px 2px #ff4d5e; } }
.vc-now { animation: vc-now 1.6s steps(2) infinite; }
@keyframes vc-flag { 0%, 60% { opacity: 1; } 61%, 100% { opacity: 0.25; } }
.vc-flag { animation: vc-flag 0.9s steps(1) infinite; }
@keyframes vc-run { from { transform: translateX(-160px); } to { transform: translateX(980px); } }
@keyframes vc-run-back { from { transform: translateX(980px); } to { transform: translateX(-200px); } }
@keyframes vc-bin {
  0%, 38% { transform: rotate(0deg) translateX(0); }
  44%, 100% { transform: rotate(84deg) translate(22px, -6px); }
}
@keyframes vc-trash {
  0%, 41% { opacity: 0; transform: translate(0, 0); }
  50% { opacity: 1; transform: translate(34px, -10px); }
  64%, 100% { opacity: 1; transform: translate(64px, 0); }
}
@keyframes vc-zzz { 0% { transform: translate(0, 0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translate(24px, -60px); opacity: 0; } }
.vc-zzz { animation: vc-zzz 3s linear infinite; }
@keyframes vc-hop { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.vc-hop { animation: vc-hop 0.32s steps(2) infinite; }
@keyframes vc-seen { 0% { transform: translateY(0); } 30% { transform: translateY(-14px); } 60% { transform: translateY(0); } 80% { transform: translateY(-5px); } 100% { transform: translateY(0); } }
.vc-seen { animation: vc-seen 0.7s steps(5) both; }
`;
