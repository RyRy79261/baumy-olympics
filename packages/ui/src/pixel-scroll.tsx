"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// A list that scrolls natively with its own scrollbar hidden and a chunky
// pixel one drawn beside it (the approved prototype's PixelScroll,
// variant-a-cal.tsx): a violet thumb on a framed track that a finger can
// tap or drag, a stepped fade at whichever end has more, and a "More below"
// button that pages down. A kitchen screen has no hover, so both ends say
// there is more rather than hiding it.

/** Snap to the 4px pixel grid. */
const snap = (n: number) => Math.round(n / 4) * 4;
const PAD = 6;

export interface ScrollMetrics {
  top: number;
  view: number;
  full: number;
  track: number;
}

/** Where the thumb sits and how big it is, in px, for these metrics. */
export function thumbFor(m: ScrollMetrics): {
  scrollable: boolean;
  height: number;
  top: number;
  atTop: boolean;
  atEnd: boolean;
} {
  const scrollable = m.full > m.view + 2;
  const inner = Math.max(0, m.track - PAD * 2);
  const height = scrollable ? Math.max(64, snap((inner * m.view) / m.full)) : 0;
  const maxTop = Math.max(1, m.full - m.view);
  const top = scrollable ? snap(((inner - height) * m.top) / maxTop) : 0;
  return {
    scrollable,
    height,
    top,
    atTop: m.top <= 4,
    atEnd: !scrollable || m.top >= maxTop - 4,
  };
}

/** The scroll offset a tap at `y` px down the track asks for. */
export function seekTo(y: number, m: ScrollMetrics, thumbH: number): number {
  const inner = Math.max(1, m.track - PAD * 2 - thumbH);
  const f = Math.min(1, Math.max(0, (y - PAD - thumbH / 2) / inner));
  return f * Math.max(0, m.full - m.view);
}

export function PixelScroll({
  children,
  tone = "var(--color-bm-bg)",
}: {
  children: ReactNode;
  /** The colour behind the list, for the fades. */
  tone?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<ScrollMetrics>({
    top: 0,
    view: 0,
    full: 0,
    track: 0,
  });

  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    setM({
      top: el.scrollTop,
      view: el.clientHeight,
      full: el.scrollHeight,
      track: track.current?.clientHeight ?? 0,
    });
  }, []);

  useEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    const el = list.current;
    if (el) {
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
    return () => ro.disconnect();
  }, [measure]);

  const t = thumbFor(m);
  const seek = (clientY: number) => {
    const el = list.current;
    const tr = track.current;
    if (!el || !tr || !t.scrollable) return;
    el.scrollTop = seekTo(
      clientY - tr.getBoundingClientRect().top,
      m,
      t.height,
    );
  };
  const shade = (c: string, pct: number) =>
    `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  // Stepped, so it reads as dithered pixels rather than a smooth gradient.
  const fade: CSSProperties = {
    background: `linear-gradient(to bottom, transparent 0 20%, ${shade(tone, 33)} 20% 40%, ${shade(tone, 60)} 40% 60%, ${shade(tone, 87)} 60% 80%, ${tone} 80%)`,
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="relative min-h-0 min-w-0 flex-1">
        <div
          ref={list}
          data-scroll-list
          onScroll={measure}
          className="h-full overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="pb-[72px]">{children}</div>
        </div>
        {!t.atTop ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 left-0 h-7"
            style={{
              background: `linear-gradient(to top, transparent 0 33%, ${shade(tone, 53)} 33% 66%, ${tone} 66%)`,
            }}
          />
        ) : null}
        {!t.atEnd ? (
          <div
            className="pointer-events-none absolute right-0 bottom-0 left-0 flex h-[110px] items-end justify-center pb-2"
            style={fade}
          >
            <button
              type="button"
              data-more
              onClick={() =>
                list.current?.scrollBy({
                  top: m.view * 0.75,
                  behavior: "smooth",
                })
              }
              className="pixel-frame pointer-events-auto flex h-14 items-center gap-3 bg-bm-raised px-6 font-label text-[16px] font-bold text-bm-text uppercase [--pf-w:3px] [--pf:var(--color-bm-line)]"
            >
              <span className="text-bm-violet motion-safe:animate-pixel-bob">
                ▼
              </span>
              More below
            </button>
          </div>
        ) : null}
      </div>
      <div
        ref={track}
        data-track
        aria-hidden
        className="pixel-frame relative w-6 shrink-0 touch-none bg-bm-chrome [--pf-w:3px] [--pf:var(--color-bm-line)]"
        style={{ opacity: t.scrollable ? 1 : 0 }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          seek(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) seek(e.clientY);
        }}
      >
        {t.scrollable ? (
          <div
            data-thumb
            className="absolute right-1.5 left-1.5 bg-bm-violet shadow-[inset_3px_3px_0_#b8adff,inset_-3px_-3px_0_#5a4bc4]"
            style={{ top: PAD + t.top, height: t.height }}
          />
        ) : null}
      </div>
    </div>
  );
}
