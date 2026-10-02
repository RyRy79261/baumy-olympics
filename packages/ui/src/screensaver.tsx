import type { CSSProperties } from "react";
import { BaumyCat } from "./baumy-cat";
import { cx } from "./cx";
import { PixelArt } from "./pixel/pixel-art";
import type { Sprite } from "./pixel/pixel-grid";
import { Raccoon } from "./raccoon";

// The kitchen screen's screensaver (ADR 0005 §6), the approved prototype's
// (proto/kiosk-home-pixel, shared-overlays.tsx `Screensaver`): a dim night
// room with a moonlit window, fairy lights, a big dim clock, Baumy asleep on
// a shelf, and three raccoons on the floor: one knocks the bin over, one
// carries a sock off, one pushes a box. It replaces the old night screen;
// the app decides when it shows (at night, and after 5 minutes untouched).
//
// It is one big button, so a tap anywhere wakes the screen and never lands
// on whatever is underneath. Under reduced motion the scene stands still:
// app/globals.css stops every animation.
//
// It sits on the screen for hours, so nothing in it holds a pixel still
// (2026-10-02): the whole room drifts a couple of pixels at a time on a
// slow loop (x and y on different periods, so it wanders over a patch
// rather than a line), the clock hops to a new spot every few minutes, and
// two washes of moonlight fade in and out over everything, as if clouds
// were passing the moon. All of it is transform and opacity, so the iPad
// composites it without repainting.

const SOCK: Sprite = [
  "..KK..",
  ".KPK..",
  ".KPK..",
  ".KPPKK",
  ".KPWPK",
  "..KKK.",
];
const BOX: Sprite = [
  "KKKKKKKKKKKK",
  "KbbbbTTbbbbK",
  "KbbbbTTbbbbK",
  "KBBBBBBBBBBK",
  "KBBBBBBBBBBK",
  "KBBBBBBBBBBK",
  "KBBBBBBBBBBK",
  "KKKKKKKKKKKK",
];
const BIN: Sprite = [
  "..KKKKKKKK..",
  "KKKGGGGGGKKK",
  "KGGGGGGGGGGK",
  ".KgKgKKgKgK.",
  ".KgKgKKgKgK.",
  ".KgKgKKgKgK.",
  ".KgKgKKgKgK.",
  ".KgKgKKgKgK.",
  "..KKKKKKKK..",
];
const TRASH: Sprite = ["..KK.K", ".KYKKW", "KPK.KK"];

/** The props the screensaver's floor clutter is drawn from, for tests. */
export const SCREENSAVER_ART = { SOCK, BOX, BIN, TRASH } as const;

const INK = "#07040c";
/** The dim clock's colour: readable across a dark kitchen, never bright. */
const CLOCK = "#3d2d57";
const LIGHTS = ["#8f7dff", "#4ff5e6", "#ff8fc7", "#ffe46b"] as const;
const STARS: readonly (readonly [number, number])[] = [
  [22, 30],
  [60, 150],
  [140, 170],
  [30, 90],
];

// The scene's own keyframes (the prototype's), scoped by their `bm-ss-`
// names. Raccoons cross the whole width of whatever screen this is.
const SCENE_CSS = `
@keyframes bm-ss-run { from { transform: translateX(-160px); } to { transform: translateX(calc(100vw + 160px)); } }
@keyframes bm-ss-run-back { from { transform: translateX(calc(100vw + 160px)); } to { transform: translateX(-200px); } }
@keyframes bm-ss-bin {
  0%, 38% { transform: rotate(0deg) translateX(0); }
  44%, 100% { transform: rotate(84deg) translate(22px, -6px); }
}
@keyframes bm-ss-trash {
  0%, 41% { opacity: 0; transform: translate(0, 0); }
  50% { opacity: 1; transform: translate(34px, -10px); }
  64%, 100% { opacity: 1; transform: translate(64px, 0); }
}
@keyframes bm-ss-bulb { 0%, 100% { opacity: 1; filter: brightness(1.2); } 50% { opacity: 0.35; filter: brightness(0.7); } }
@keyframes bm-ss-zzz { 0% { transform: translate(0, 0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translate(24px, -60px); opacity: 0; } }
@keyframes bm-ss-hop { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes bm-ss-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.15; } }
@keyframes bm-ss-drift-x { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(24px); } 75% { transform: translateX(-24px); } }
@keyframes bm-ss-drift-y { 0%, 100% { transform: translateY(0); } 25% { transform: translateY(-20px); } 75% { transform: translateY(20px); } }
@keyframes bm-ss-clock {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-40px, 56px); }
  40% { transform: translate(-12px, 104px); }
  60% { transform: translate(-56px, 28px); }
  80% { transform: translate(-24px, 80px); }
}
@keyframes bm-ss-wash { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
`;

/** The room's drift: 2px steps, x and y on co-prime periods. */
const DRIFT_X: CSSProperties = {
  animation: "bm-ss-drift-x 420s steps(12) infinite",
};
const DRIFT_Y: CSSProperties = {
  animation: "bm-ss-drift-y 660s steps(10) infinite",
};
/** The clock's hop: a new spot every four minutes. */
const CLOCK_HOP: CSSProperties = {
  animation: "bm-ss-clock 1200s steps(1) infinite",
};
/** Moonlight and a plum glow, fading in and out out of step. */
const WASHES = [
  { colour: "#3a4fb8", peak: 0.14, period: "190s", delay: "0s" },
  { colour: "#a0336e", peak: 0.1, period: "310s", delay: "-120s" },
] as const;

const bulb = (delay: number, duration = "1.8s"): CSSProperties => ({
  animation: `bm-ss-bulb ${duration} steps(2) infinite`,
  animationDelay: `${delay}s`,
});

export function Screensaver({
  time,
  date,
  onWake,
}: {
  /** "23:41". */
  time: string;
  /** "Monday 28 September". */
  date: string;
  onWake: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="screensaver"
      aria-label={`Screensaver, ${time}. Tap anywhere to wake the screen.`}
      onClick={onWake}
      className={cx(
        "fixed inset-0 z-[60] block h-dvh w-screen touch-manipulation overflow-hidden text-left",
        "bg-[linear-gradient(180deg,#07040c_0%,#120a1d_60%,#1a0d18_100%)]",
        "focus-visible:outline-4 focus-visible:-outline-offset-8 focus-visible:outline-bm-dim",
      )}
    >
      <style>{SCENE_CSS}</style>
      <span data-drift className="absolute inset-0 block" style={DRIFT_X}>
        <span className="absolute inset-0 block" style={DRIFT_Y}>
          {/* The window, with the moon and a few stars. */}
          <span
            aria-hidden
            className="absolute top-[140px] left-[70px] block h-[220px] w-[180px] bg-[#0d1430] shadow-[0_0_0_6px_#241a33,inset_0_0_0_3px_#07040c]"
          >
            <span className="absolute top-0 left-1/2 block h-full w-[6px] -translate-x-1/2 bg-[#241a33]" />
            <span className="absolute top-1/2 left-0 block h-[6px] w-full -translate-y-1/2 bg-[#241a33]" />
            <span
              className="absolute top-[22px] left-[104px] block size-[40px] bg-[#fff7c2] shadow-[0_0_30px_#fff7c2aa]"
              style={{
                clipPath:
                  "polygon(20% 0,80% 0,100% 20%,100% 80%,80% 100%,20% 100%,0 80%,0 20%)",
              }}
            />
            {STARS.map(([x, y], i) => (
              <span
                key={i}
                className="absolute block size-[3px] bg-white"
                style={{ left: x, top: y, ...bulb(i * 0.5) }}
              />
            ))}
          </span>
          {/* Fairy lights, dim, strung across the top. */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-[40px] block opacity-60"
          >
            {Array.from({ length: 16 }, (_, i) => {
              const c = LIGHTS[i % 4]!;
              return (
                <span
                  key={i}
                  data-light
                  className="absolute block h-[8px] w-[6px]"
                  style={{
                    left: `calc(20px + ${i / 15} * (100% - 40px))`,
                    top: Math.sin((i / 15) * Math.PI) * 30,
                    background: c,
                    boxShadow: `0 0 10px ${c}`,
                    ...bulb(i * 0.3, "3s"),
                  }}
                />
              );
            })}
          </span>
          {/* The big dim clock. */}
          <span
            data-clock
            className="absolute top-[170px] right-[60px] block text-right"
            style={CLOCK_HOP}
          >
            <span
              data-testid="screensaver-time"
              className="block font-display text-[84px] leading-none [text-shadow:0_0_30px_#8f7dff33]"
              style={{ color: CLOCK }}
            >
              {time}
            </span>
            <span
              className="mt-6 block font-label text-[20px] font-bold uppercase"
              style={{ color: CLOCK }}
            >
              {date} · all quiet
            </span>
          </span>
          {/* Baumy, asleep on a shelf. */}
          <span aria-hidden className="absolute top-[47%] left-[57%] block">
            <span className="relative block opacity-70">
              <span className="absolute -top-[40px] right-[-6px] block">
                <span
                  className="absolute block font-display text-[18px] text-bm-violet"
                  style={{ animation: "bm-ss-zzz 3s linear infinite" }}
                >
                  z
                </span>
                <span
                  className="absolute block font-display text-[14px] text-bm-teal"
                  style={{
                    animation: "bm-ss-zzz 3s linear infinite",
                    animationDelay: "1.5s",
                  }}
                >
                  z
                </span>
              </span>
              <BaumyCat
                state="sleeping"
                scale={3}
                facing="right"
                showMark={false}
              />
            </span>
            <span className="block h-[12px] w-[200px] -translate-x-[40px] bg-[#3a2518] shadow-[0_4px_0_#1a0f0a]" />
          </span>
          {/* The floor, and what happens on it. */}
          <span
            aria-hidden
            className="absolute -inset-x-8 top-[71%] -bottom-8 block bg-[repeating-linear-gradient(90deg,#1d1020_0_80px,#180c1a_80px_160px)] shadow-[inset_0_4px_0_#2a1628]"
          >
            {/* The bin that gets knocked over, and what falls out. */}
            <span className="absolute -top-[54px] left-[46%] block">
              <span
                className="block"
                style={{
                  animation: "bm-ss-bin 7s steps(6) infinite",
                  transformOrigin: "100% 100%",
                }}
              >
                <PixelArt
                  grid={BIN}
                  scale={6}
                  palette={{ K: INK, G: "#3d4a5c", g: "#2c3645" }}
                  className="block"
                />
              </span>
              <span
                className="absolute bottom-0 left-[70px] block"
                style={{ animation: "bm-ss-trash 7s steps(8) infinite" }}
              >
                <PixelArt
                  grid={TRASH}
                  scale={5}
                  palette={{ K: INK, Y: "#8a7a2c", W: "#6f6a80", P: "#7a3a5c" }}
                  className="block"
                />
              </span>
            </span>
            {/* Raccoon 1 runs right into the bin. */}
            <span
              data-raccoon="bin"
              className="absolute -top-[60px] left-0 block"
              style={{ animation: "bm-ss-run 7s linear infinite" }}
            >
              <Raccoon scale={6} />
            </span>
            {/* Raccoon 2 carries a sock back left. */}
            <span
              data-raccoon="sock"
              className="absolute top-[60px] left-0 block"
              style={{
                animation: "bm-ss-run-back 9s linear infinite",
                animationDelay: "-3s",
              }}
            >
              <span className="relative block">
                <span
                  className="absolute -top-[22px] left-[40px] block"
                  style={{ animation: "bm-ss-hop 0.32s steps(2) infinite" }}
                >
                  <PixelArt
                    grid={SOCK}
                    scale={5}
                    palette={{ K: INK, P: "#b84a8a", W: "#e8e4f0" }}
                    className="block"
                  />
                </span>
                <Raccoon scale={6} flip />
              </span>
            </span>
            {/* Raccoon 3 pushes a box. */}
            <span
              data-raccoon="box"
              className="absolute top-[170px] left-0 block"
              style={{
                animation: "bm-ss-run 14s linear infinite",
                animationDelay: "-6s",
              }}
            >
              <span className="flex items-end">
                <Raccoon scale={6} />
                <span className="-ml-1 block">
                  <PixelArt
                    grid={BOX}
                    scale={6}
                    palette={{
                      K: INK,
                      B: "#6b4a2a",
                      b: "#8a6238",
                      T: "#c9a46a",
                    }}
                    className="block"
                  />
                </span>
              </span>
            </span>
          </span>
          <span className="absolute inset-x-0 bottom-[40px] block text-center">
            <span
              className="font-display text-[16px] text-bm-dim"
              style={{ animation: "bm-ss-blink 2.2s steps(1) infinite" }}
            >
              TAP ANYWHERE TO WAKE
            </span>
          </span>
        </span>
      </span>
      {WASHES.map((w) => (
        <span
          key={w.colour}
          aria-hidden
          data-wash
          className="pointer-events-none absolute inset-0 block"
          style={{ opacity: w.peak }}
        >
          <span
            className="block size-full"
            style={{
              background: w.colour,
              animation: `bm-ss-wash ${w.period} ease-in-out infinite`,
              animationDelay: w.delay,
            }}
          />
        </span>
      ))}
    </button>
  );
}
