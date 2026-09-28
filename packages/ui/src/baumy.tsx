import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Sprite, type SpriteState } from "./sprite";

// The Baumy command sheet in the pixel kit (SPEC §3.6; ADR 0005): Baumy
// (the cat, in its mood) with a speech bubble, and one proposal row of the
// review list. Pages only fill them in.

/**
 * Baumy's answer. The bubble is a polite live region, so a screen reader
 * reads each new answer; `tone="error"` is an alert instead.
 */
export function SpeechBubble({
  state = "idle",
  tone = "normal",
  children,
  className,
}: {
  /** The sprite's state beside the bubble. */
  state?: SpriteState;
  tone?: "normal" | "error";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-end gap-4", className)}>
      <Sprite name="baumy" state={state} size={3} label={`Baumy (${state})`} />
      <div
        role={tone === "error" ? "alert" : "status"}
        aria-live={tone === "error" ? "assertive" : "polite"}
        data-testid="baumy-says"
        className={cx(
          "m-1 min-h-11 flex-1 px-3 py-2 text-xl leading-snug",
          "shadow-[0_-4px_0_var(--color-bm-bubble-ink),0_4px_0_var(--color-bm-bubble-ink),-4px_0_0_var(--color-bm-bubble-ink),4px_0_0_var(--color-bm-bubble-ink)]",
          tone === "error"
            ? "bg-bm-red text-bm-ink"
            : "bg-bm-bubble text-bm-bubble-ink",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Where a proposal is in its review. */
export type ProposalState =
  "pending" | "saving" | "saved" | "failed" | "rejected";

const STATE_LABEL: Record<ProposalState, string> = {
  pending: "Waiting for you",
  saving: "Saving…",
  saved: "Done",
  failed: "Not saved",
  rejected: "Rejected",
};

/**
 * One proposal: the line to approve, its tags (destructive, needs a PIN, not
 * valid), where it is, a message, and its buttons and editor as children.
 */
export function ProposalItem({
  preview,
  title,
  state,
  tags = [],
  message,
  children,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLLIElement>, "title"> & {
  preview: ReactNode;
  title: string;
  state: ProposalState;
  tags?: readonly string[];
  /** Why it failed, or what saving it did. */
  message?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      data-state={state}
      className={cx(
        "pixel-frame flex flex-col gap-2 bg-bm-surface p-3 text-bm-text",
        state === "saved" && "[--pf:var(--color-bm-green)]",
        state === "failed" && "[--pf:var(--color-bm-red)]",
        (state === "rejected" || state === "saved") && "opacity-75",
        className,
      )}
      {...props}
    >
      <p className="text-xl leading-snug text-bm-text">{preview}</p>
      <p className="flex flex-wrap items-center gap-2 font-label text-sm text-bm-muted uppercase">
        <span>{title}</span>
        {tags.map((t) => (
          <span
            key={t}
            className="pixel-frame px-1.5 text-xs text-bm-amber [--pf:var(--color-bm-amber)]"
          >
            {t}
          </span>
        ))}
        <span data-testid="proposal-state">{STATE_LABEL[state]}</span>
      </p>
      {message ? (
        <p
          role={state === "failed" ? "alert" : "status"}
          className={cx(
            "text-base",
            state === "failed" ? "text-bm-red" : "text-bm-muted",
          )}
        >
          {message}
        </p>
      ) : null}
      {children}
    </li>
  );
}
