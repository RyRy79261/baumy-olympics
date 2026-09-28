"use client";

// PROTOTYPE (issue #7), throwaway. Baumy sits on the right, just being a cat
// (breathing fairy lights, blinks, ear twitches, a tail flick), and the
// speech bubbles come from it. Tap it to talk: it listens, then shows what it
// understood as changes to approve. The art is baumy-draw.ts.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BAUMY_H, BAUMY_PAL, BAUMY_W, drawBaumy } from "./baumy-draw";

export function BaumyArt({ scale = 3, sleeping = false }: { scale?: number; sleeping?: boolean }) {
  return <Sprite rows={frame({ blink: sleeping, twinkle: 0, tail: 0, ear: 0, talk: false })} scale={scale} />;
}

function Sprite({ rows, scale }: { rows: string[]; scale: number }) {
  return (
    <svg viewBox={`0 0 ${BAUMY_W} ${BAUMY_H}`} width={BAUMY_W * scale} height={BAUMY_H * scale} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) =>
          BAUMY_PAL[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={BAUMY_PAL[ch]} /> : null,
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
    <div className="absolute bottom-[calc(100%+6px)] right-0 w-[440px]">
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
          className="absolute -bottom-[16px] block h-[12px] w-[20px]"
          style={{ right: 70, background: "#f6ecff", boxShadow: "4px 0 0 #1a1026, -4px 0 0 #1a1026, 0 4px 0 #1a1026" }}
        />
      </div>
    </div>
  );
}

const frameCache = new Map<string, string[]>();
function frame(o: { blink: boolean; twinkle: number; tail: number; ear: number; talk: boolean }) {
  const k = JSON.stringify(o);
  let f = frameCache.get(k);
  if (!f) frameCache.set(k, (f = drawBaumy(o)));
  return f;
}

export function BaumyCat({ scale = 3 }: { scale?: number }) {
  const [mode, setMode] = useState<Mode>("idle");
  // One tick = 150 ms. The first render is tick 0 on server and client alike.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 150);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (mode !== "done") return;
    const t = window.setTimeout(() => setMode("idle"), 3500);
    return () => window.clearTimeout(t);
  }, [mode]);

  const talking = mode === "listening" || mode === "done";
  const rows = useMemo(
    () =>
      frame({
        blink: !talking && tick % 30 === 29, // blinks every 4.5 s
        twinkle: Math.floor(tick / 5) % 4, // the lights step every 0.75 s
        tail: Math.floor(tick / 12) % 5 === 0 ? 1 : 0, // a tail flick now and then
        ear: tick % 70 >= 66 ? 1 : 0, // an ear twitch
        talk: talking && tick % 4 < 2,
      }),
    [tick, talking],
  );

  return (
    <div className="absolute bottom-[4px] right-[14px] z-30" data-voice-cat>
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
        className="block"
        style={{ touchAction: "manipulation" }}
      >
        <Sprite rows={rows} scale={scale} />
      </button>
    </div>
  );
}
