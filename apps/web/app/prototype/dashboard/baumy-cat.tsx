"use client";

// PROTOTYPE (issue #7), throwaway. Baumy is Camp 404's INKBLOT cat, as it is
// (baumy-cat-frames.ts, same colours): a small black cat seen from the side,
// sitting on a cushion in the corner. It just sits there; tap it and it
// listens, then shows what it understood as changes to approve.

import { useEffect, useState, type ReactNode } from "react";
import { CAT_FRAMES, CAT_H, CAT_W } from "./baumy-cat-frames";

// The idle frames leave their top 4 rows empty; crop them so the cat fills its spot.
const CROP = 4;
const IDLE = CAT_FRAMES.idle.map((f) => f.slice(CROP));
const H = CAT_H - CROP;

// camp-404 apps/join/components/os/inkblot-sprites.ts COLOURS.
const COL: Record<string, string> = {
  K: "oklch(0.13 0.02 295)",
  D: "oklch(0.3 0.06 295)",
  O: "oklch(0.05 0.01 295)",
  E: "oklch(0.75 0.24 340)",
};

function Sprite({ rows, scale, flip }: { rows: readonly string[]; scale: number; flip?: boolean }) {
  return (
    <svg
      viewBox={`0 0 ${CAT_W} ${H}`}
      width={CAT_W * scale}
      height={H * scale}
      shapeRendering="crispEdges"
      aria-hidden
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
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

  const rows = IDLE[Math.floor(tick / 3) % IDLE.length]!;

  return (
    <div className="absolute bottom-[0px] right-[28px] z-30" data-voice-cat>
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
        className="relative block"
        style={{ touchAction: "manipulation" }}
      >
        {/* a soft lit patch of wall, so the black cat reads on the dark screen */}
        <span
          className="absolute inset-x-[-14px] bottom-0 top-[-8px] block"
          style={{ background: "oklch(0.32 0.08 295)", clipPath: "polygon(8px 0,calc(100% - 8px) 0,100% 8px,100% 100%,0 100%,0 8px)" }}
        />
        <span className="relative block">
          <Sprite rows={rows} scale={scale} flip />
        </span>
        {/* the cushion */}
        <span className="absolute inset-x-[-14px] bottom-0 block h-[10px]" style={{ background: "oklch(0.52 0.22 340)", boxShadow: "inset 0 -4px 0 oklch(0.38 0.17 340)" }} />
      </button>
    </div>
  );
}
