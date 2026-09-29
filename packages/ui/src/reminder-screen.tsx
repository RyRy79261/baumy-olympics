"use client";

import { avatarFor, type AvatarSprites } from "@baumy/types";
import { useState, type CSSProperties } from "react";
import { BaumyCat } from "./baumy-cat";
import { cx } from "./cx";
import { SHIRT_COLOURS } from "./housemate";
import { MemberCharacter } from "./member-character";
import { Glyph } from "./pixel/glyph";

// The kitchen screen's full-screen reminder (ADR 0005 §4), the approved
// prototype's (proto/kiosk-home-pixel, shared-overlays.tsx `Reminder`): a
// hazard-striped frame, a blinking REMINDER, the note in a retro window,
// "x of N have seen it", every housemate as their 16-bit character with a
// big "I've seen it" button, and "Dismiss for everyone". The app runs the
// actions; this only draws and reports taps.
//
// "Dismiss for everyone" needs someone to do it as, so it first asks who:
// each name is a button, and Cancel goes back.

/** A housemate on the reminder screen. */
export interface ReminderFace {
  id: string;
  displayName: string;
  /**
   * `members.avatar` as stored; null draws their default character. Their
   * name, their seen card and their dismiss button take its shirt colour.
   */
  avatar: unknown;
  /** Their gallery sprite (issue #111), drawn instead when they picked one. */
  sprites?: AvatarSprites | null;
  seen: boolean;
}

const C = {
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
  red: "#ff4d5e",
  green: "#43f0a0",
} as const;

/** The prototype's raised (or pressed) bevel: light top-left, dark bottom-right. */
/** A face's colour: their character's shirt. */
export function faceColour(face: Pick<ReminderFace, "id" | "avatar">): string {
  return SHIRT_COLOURS[
    avatarFor({ id: face.id, avatar: face.avatar }).shirtColor
  ];
}

function bevel(raised = true): CSSProperties {
  return {
    boxShadow: raised
      ? `0 0 0 2px ${C.lo}, inset 2px 2px 0 ${C.hi}, inset -2px -2px 0 #120a1d`
      : `0 0 0 2px ${C.lo}, inset 2px 2px 0 #0a0612, inset -2px -2px 0 ${C.hi}`,
  };
}

const SCREEN_CSS = `
@keyframes bm-rm-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.15; } }
@keyframes bm-rm-seen { 0% { transform: translateY(0); } 30% { transform: translateY(-14px); } 60% { transform: translateY(0); } 80% { transform: translateY(-5px); } 100% { transform: translateY(0); } }
@keyframes bm-rm-led { 0%, 80% { opacity: 1; } 85% { opacity: 0.3; } 90%, 100% { opacity: 1; } }
`;

const blink: CSSProperties = { animation: "bm-rm-blink 1s steps(1) infinite" };

export function ReminderScreen({
  title,
  body,
  from,
  faces,
  onSeen,
  onDismiss,
  choosingDismisser = false,
  onDismissAs,
  onCancelDismiss,
  busy = false,
  message,
}: {
  title: string;
  body: string;
  /** Who posted it. */
  from: string;
  /** Everyone who must see it, in the order they joined. */
  faces: readonly ReminderFace[];
  /** A face's "I've seen it" was tapped. */
  onSeen: (memberId: string) => void;
  /** "Dismiss for everyone" was tapped: ask who. */
  onDismiss: () => void;
  /** Showing "Who is dismissing it?" instead of the dismiss button. */
  choosingDismisser?: boolean;
  onDismissAs?: (memberId: string) => void;
  onCancelDismiss?: () => void;
  /** A tap is on its way: the buttons wait. */
  busy?: boolean;
  /** Why the last tap did not take, if it did not. */
  message?: string;
}) {
  const seen = faces.filter((f) => f.seen).length;
  // Only the face that was just tapped plays its emote (issue #111), not
  // everyone who had seen it already when the screen came up.
  const [tapped, setTapped] = useState<string | null>(null);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminder-title"
      aria-describedby={body ? "reminder-body" : undefined}
      data-reminder
      className="fixed inset-0 z-50 flex touch-manipulation overflow-y-auto p-8 select-none"
      style={{
        background: `radial-gradient(circle at 50% 30%, #5a1838 0%, ${C.wineDk} 45%, #12060d 100%)`,
      }}
    >
      <style>{SCREEN_CSS}</style>
      {/* The hazard frame. */}
      <span
        aria-hidden
        className="pointer-events-none fixed inset-3 block"
        style={{
          border: "10px solid transparent",
          borderImage: `repeating-linear-gradient(45deg, ${C.amber} 0 14px, ${C.ink} 14px 28px) 10`,
        }}
      />
      {/* Centred while it fits; scrolls from the top when it does not, with
          room at the bottom so Baumy never covers the last button. */}
      <div className="m-auto flex w-full flex-col items-center gap-6 sm:pb-36">
        <div className="flex items-center gap-4" aria-hidden>
          <span style={blink}>
            <Glyph name="alarm" size={56} color={C.red} />
          </span>
          <span
            className="font-display text-[40px] sm:text-[52px]"
            style={{
              color: C.amber,
              textShadow: `4px 4px 0 ${C.lo}, 0 0 24px ${C.amber}88`,
            }}
          >
            REMINDER
          </span>
          <span style={blink}>
            <Glyph name="alarm" size={56} color={C.red} />
          </span>
        </div>
        <section
          className="flex w-full max-w-[720px] flex-col"
          style={{ background: C.panel, ...bevel() }}
        >
          <header
            className="flex h-[26px] shrink-0 items-center gap-1.5 px-1.5"
            style={{
              background: `linear-gradient(90deg, ${C.wine} 0%, #5a1838 55%, ${C.chrome} 100%)`,
              borderBottom: `2px solid ${C.lo}`,
            }}
          >
            <Glyph name="pin" size={16} color={C.amberLt} />
            <span
              data-testid="reminder-from"
              className="truncate font-label text-[13px] font-bold tracking-wider uppercase"
              style={{ color: C.text }}
            >
              notice.txt — from {from}
            </span>
            <span className="flex-1" />
            <span
              aria-hidden
              className="size-[8px]"
              style={{
                background: C.red,
                boxShadow: `0 0 6px ${C.red}`,
                animation: "bm-rm-led 3s steps(1) infinite",
              }}
            />
            {["_", "□", "×"].map((b) => (
              <span
                key={b}
                aria-hidden
                className="grid size-[16px] place-items-center font-label text-[10px] leading-none"
                style={{ background: C.chrome, color: C.muted, ...bevel() }}
              >
                {b}
              </span>
            ))}
          </header>
          <div className="p-5">
            <h2
              id="reminder-title"
              className="font-display text-[26px] leading-snug"
              style={{ color: C.text }}
            >
              {title}
            </h2>
            {body ? (
              <p
                id="reminder-body"
                className="mt-3 font-body text-[26px] leading-snug whitespace-pre-line"
                style={{ color: C.amberLt }}
              >
                {body}
              </p>
            ) : null}
          </div>
        </section>
        <p
          data-testid="reminder-count"
          role="status"
          className="font-label text-[16px] font-bold uppercase"
          style={{ color: C.muted }}
        >
          {seen} of {faces.length} have seen it
        </p>
        <div
          className="grid w-full max-w-[740px] gap-4"
          style={{
            gridTemplateColumns: `repeat(${Math.min(Math.max(faces.length, 1), 4)}, minmax(0, 1fr))`,
          }}
        >
          {faces.map((f) => (
            <div
              key={f.id}
              data-face={f.id}
              data-seen={f.seen}
              className="flex flex-col items-center gap-3 p-3"
              style={{
                background: f.seen ? `${faceColour(f)}26` : C.panel,
                ...bevel(),
              }}
            >
              <span
                className="relative block"
                style={
                  f.seen
                    ? { animation: "bm-rm-seen 0.7s steps(5) both" }
                    : undefined
                }
              >
                <MemberCharacter
                  moment={f.seen && f.id === tapped ? "emote" : undefined}
                  sprites={f.sprites}
                  avatar={f.avatar}
                  memberId={f.id}
                  scale={7}
                  bob={!f.seen}
                />
                {f.seen ? (
                  <span className="absolute -top-2 -right-3">
                    <Glyph name="check" size={36} color={C.green} />
                  </span>
                ) : null}
              </span>
              <span
                className="max-w-full truncate font-display text-[16px] uppercase"
                style={{ color: faceColour(f) }}
              >
                {f.displayName}
              </span>
              <button
                type="button"
                disabled={f.seen || busy}
                aria-label={
                  f.seen
                    ? `${f.displayName} has seen it`
                    : `I've seen it, ${f.displayName}`
                }
                onClick={() => {
                  setTapped(f.id);
                  onSeen(f.id);
                }}
                className={cx(
                  "h-[72px] w-full font-display text-[14px] leading-tight uppercase",
                  "active:translate-y-px disabled:cursor-default",
                  busy && !f.seen && "opacity-70",
                )}
                style={{
                  background: f.seen ? C.green : C.amber,
                  color: C.ink,
                  ...bevel(!f.seen),
                }}
              >
                {f.seen ? "Seen ✓" : "I've seen it"}
              </button>
            </div>
          ))}
        </div>
        {message ? (
          <p
            role="alert"
            className="max-w-[720px] px-4 py-2 text-center font-body text-xl"
            style={{ background: C.ink, color: C.red, ...bevel() }}
          >
            {message}
          </p>
        ) : null}
        {choosingDismisser ? (
          <div
            data-testid="reminder-dismissers"
            className="flex max-w-[740px] flex-col items-center gap-3"
          >
            <p
              className="font-label text-[16px] font-bold uppercase"
              style={{ color: C.text }}
            >
              Who is dismissing it for everyone?
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {faces.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onDismissAs?.(f.id)}
                  aria-label={f.displayName}
                  title={f.displayName}
                  className="h-[56px] max-w-[240px] min-w-[120px] truncate px-4 font-display text-[14px] uppercase active:translate-y-px"
                  style={{
                    background: C.chrome,
                    color: faceColour(f),
                    ...bevel(),
                  }}
                >
                  {f.displayName}
                </button>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={onCancelDismiss}
                className="h-[56px] min-w-[120px] px-4 font-label text-[15px] font-bold uppercase active:translate-y-px"
                style={{ background: C.panel, color: C.muted, ...bevel() }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onDismiss}
            className="mt-2 h-[56px] px-6 font-label text-[15px] font-bold uppercase active:translate-y-px"
            style={{ background: C.chrome, color: C.muted, ...bevel() }}
          >
            Dismiss for everyone
          </button>
        )}
      </div>
      <div
        aria-hidden
        className="pointer-events-none fixed right-[40px] bottom-[40px] flex items-end gap-2 max-sm:hidden"
      >
        <span
          className="relative mb-16 block px-2 py-1 font-body text-[20px]"
          style={{ background: C.text, color: C.ink, ...bevel() }}
        >
          everyone tap your face pls
        </span>
        <BaumyCat scale={3} />
      </div>
    </div>
  );
}
