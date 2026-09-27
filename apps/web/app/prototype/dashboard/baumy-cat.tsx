"use client";

// PROTOTYPE (issue #7), throwaway. Baumy as a full-body 16-bit cat (a chibi
// sitting pose in the spirit of Camp 404's INKBLOT cat): black fluffy coat,
// one green and one blue-violet eye, a pastel party hat and a collar of
// fairy lights (design/baumy-reference.png). It just sits there, blinks and
// breathes; tap it and it listens, then shows what it understood as changes
// to approve.

import { useEffect, useState, type ReactNode } from "react";

const COL: Record<string, string> = {
  O: "#4a3b78", // outline, light enough that the black cat reads on the dark screen
  K: "#1e1530", // coat
  D: "#3b2d58", // sheen
  R: "#7a66b8", // ear rim
  G: "#43f0a0", // green eye
  g: "#1f9e66",
  V: "#8f7dff", // blue-violet eye
  v: "#5842d8",
  W: "#ffffff",
  P: "#ff8fc7", // nose, pink lights
  p: "#8a3a6e", // inner ear, open mouth
  H: "#ffb8e0", // hat
  h: "#c9a7ff",
  Y: "#ffe46b", // star, yellow lights
  T: "#4ff5e6", // teal lights
  M: "#9d90bf", // whiskers
};

const BASE = [
  "..............Y...............",
  ".............YWY..............",
  "..............H...............",
  ".............HhH..............",
  ".....O.......hHY.......O......",
  "....ORO.....HHhHH.....ORO.....",
  "....OpRO...OOOOOOO...ORpO.....",
  "....OppROOOKKKKKKKOOORppO.....",
  "....OppDKKKKKKKKKKKKKDppO.....",
  "....ODKKKKKKKKKKKKKKKKKDO.....",
  "...ODKKKKKKKKKKKKKKKKKKKDO....",
  "...OKKKKKKKKKKKKKKKKKKKKKO....",
  "...OKKKGGGKKKKKKKKVVVKKKKO....",
  "..MOKKGWGGKKKKKKKKVWVVKKKOM...",
  "...OKKGGGGKKKKKKKKVVVVKKKO....",
  "..MOKKKGGKKKKPPKKKKVVKKKKOM...",
  "...OKKKKKKKKKOOKKKKKKKKKKO....",
  "....ODKKKKKKKKKKKKKKKKKKO.....",
  ".....OODKKKKKKKKKKKKKKOO......",
  ".....OTOOPOOYOOTOOPOOYO.......",
  "....ODKKKKKKKKKKKKKKKKDO......",
  "...ODKKKKKKKKKKKKKKKKKKDO.....",
  "...OKKKKKKKKKKKKKKKKKKKKO..OO.",
  "..ODKKKKKKKKKKKKKKKKKKKKDO.ODO",
  "..OKKKKKKKKKKKKKKKKKKKKKKO.OKO",
  "..OKKKKKKKKKKKKKKKKKKKKKKO.OKO",
  "..OKKKKKKKKKKKKKKKKKKKKKKOOKKO",
  "..ODKKKKOKKKKKKKKKKOKKKKDOKKO.",
  "...OKKKKOKKKKKKKKKKOKKKKKKKO..",
  "...OKDDKOKKKKKKKKKKOKDDKKOO...",
  "....OOOO.OOOOOOOOOO.OOOOO.....",
];
const W = 30;
const H = BASE.length;

const edit = (rows: string[], y: number, x: number, s: string) => {
  rows[y] = rows[y]!.slice(0, x) + s + rows[y]!.slice(x + s.length);
};

/** Eyes shut: content little lines where the eyes were. */
const BLINK = (() => {
  const r = [...BASE];
  for (let y = 12; y <= 15; y++) r[y] = r[y]!.replace(/[GgWVv]/g, "K");
  edit(r, 14, 6, "gggg");
  edit(r, 14, 18, "vvvv");
  return r;
})();

/** Mouth open, for talking. */
const TALK = (() => {
  const r = [...BASE];
  edit(r, 16, 13, "pp");
  return r;
})();

function Sprite({ rows, scale }: { rows: string[]; scale: number }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W * scale} height={H * scale} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) =>
          COL[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COL[ch]} /> : null,
        ),
      )}
    </svg>
  );
}

type Mode = "idle" | "listening" | "heard" | "done";

const font = {
  press: "font-[family-name:var(--font-press)]",
  pix: "font-[family-name:var(--font-pixelify)]",
  silk: "font-[family-name:var(--font-silk)]",
};

function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-[calc(100%+14px)] right-[10px] w-[440px]">
      <div
        className="relative p-5"
        style={{
          background: "#f6ecff",
          color: "#1a1026",
          boxShadow: "0 -4px 0 #1a1026, 0 4px 0 #1a1026, -4px 0 0 #1a1026, 4px 0 0 #1a1026, 0 10px 0 rgba(0,0,0,.35)",
        }}
      >
        {children}
        <span
          className="absolute -bottom-[16px] right-[60px] block h-[12px] w-[20px]"
          style={{ background: "#f6ecff", boxShadow: "4px 0 0 #1a1026, -4px 0 0 #1a1026, 0 4px 0 #1a1026" }}
        />
      </div>
    </div>
  );
}

export function BaumyCat({ scale = 5 }: { scale?: number }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 200);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (mode !== "done") return;
    const t = window.setTimeout(() => setMode("idle"), 3500);
    return () => window.clearTimeout(t);
  }, [mode]);

  // Blink for one tick every 4 s; while listening, the mouth moves.
  const rows =
    mode === "listening" ? (tick % 2 ? TALK : BASE) : tick % 20 === 0 ? BLINK : BASE;

  return (
    <div className="absolute bottom-[80px] right-[22px] z-30" data-voice-cat>
      {mode === "listening" && (
        <Bubble>
          <div className="flex items-center gap-4">
            <div className="flex h-[36px] items-end gap-[5px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="cm-eq block h-full w-[8px]" style={{ background: "#ff5a7a", animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <span className={`${font.press} text-[16px]`}>Mrrp? I&apos;m listening…</span>
          </div>
          <p className={`${font.pix} mt-3 text-[22px] leading-snug text-[#4a3a66]`}>
            Say it like a voice note: &ldquo;I bought cat food and the bins are out.&rdquo;
          </p>
          <button
            type="button"
            onClick={() => setMode("heard")}
            className={`${font.silk} mt-4 h-[56px] w-full text-[16px] font-bold uppercase text-white`}
            style={{ background: "#1a1026" }}
          >
            Done talking
          </button>
        </Bubble>
      )}
      {mode === "heard" && (
        <Bubble>
          <p className={`${font.press} text-[14px]`}>Got it! I&apos;ll do this:</p>
          <ul className={`${font.pix} mt-3 space-y-1 text-[22px]`}>
            <li>✔ Cat food bought, Ryan <b className="text-[#b8860b]">+20</b></li>
            <li>✔ Bins out, Ryan <b className="text-[#b8860b]">+20</b></li>
          </ul>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => setMode("done")}
              className={`${font.silk} h-[56px] flex-1 text-[16px] font-bold uppercase text-white`}
              style={{ background: "#1f9e66" }}
            >
              Yes, do it
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className={`${font.silk} h-[56px] flex-1 text-[16px] font-bold uppercase`}
              style={{ background: "#e4d6f5", color: "#1a1026" }}
            >
              No
            </button>
          </div>
        </Bubble>
      )}
      {mode === "done" && (
        <Bubble>
          <p className={`${font.press} text-[16px]`}>Purrfect. +40 for Ryan ✦</p>
        </Bubble>
      )}
      <button
        type="button"
        onClick={() => setMode((m) => (m === "idle" || m === "done" ? "listening" : m))}
        aria-label="Talk to Baumy"
        className="proto-bob block"
        style={{ touchAction: "manipulation" }}
      >
        <Sprite rows={rows} scale={scale} />
      </button>
    </div>
  );
}
