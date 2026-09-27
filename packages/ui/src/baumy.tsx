import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Sprite, type SpriteState } from "./sprite";

// NEUTRAL PLACEHOLDERS for the Baumy command sheet (SPEC §3.6; issue #7
// restyles them here, and issue #22 draws the sprite's states): Baumy with a
// speech bubble, and one proposal row of the review list. Pages only fill
// them in.

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
    <div className={cx("flex items-start gap-3", className)}>
      <Sprite
        name="baumy"
        state={state}
        size={3}
        color="#171717"
        label={`Baumy (${state})`}
      />
      <div
        role={tone === "error" ? "alert" : "status"}
        aria-live={tone === "error" ? "assertive" : "polite"}
        data-testid="baumy-says"
        className={cx(
          "min-h-11 flex-1 rounded border px-3 py-2 text-base",
          tone === "error"
            ? "border-red-700 bg-red-50 text-red-800"
            : "border-neutral-400 bg-white text-neutral-900",
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
        "flex flex-col gap-2 rounded border border-neutral-300 bg-white p-3",
        (state === "rejected" || state === "saved") && "opacity-75",
        className,
      )}
      {...props}
    >
      <p className="text-base font-medium text-neutral-900">{preview}</p>
      <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <span>{title}</span>
        {tags.map((t) => (
          <span
            key={t}
            className="rounded border border-neutral-400 px-1.5 text-xs"
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
            "text-sm",
            state === "failed" ? "text-red-800" : "text-neutral-700",
          )}
        >
          {message}
        </p>
      ) : null}
      {children}
    </li>
  );
}
