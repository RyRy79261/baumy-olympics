"use client";

import { useEffect, type ReactNode } from "react";
import { Button } from "@baumy/ui";
import { AttestedForm } from "@/components/kiosk/attested-form";
import { useActionForm, type FormAction } from "@/components/use-action-form";
import type { ActionResult } from "@/lib/actions/result";
import type { UpdateBountiesData } from "@/lib/actions/update-bounties";

// How the mass bounty editor's one Save is sent (issue #217): the editor's
// body is written once, and the form around it is one of two adapters. The
// admin page's session attests itself (`hubSubmit`); the kitchen screen
// sends it through AttestedForm, so the picked admin's PIN goes with the
// one save (`kioskSubmit`). Each owns its buttons and where the status and
// the error stand; the editor owns what they say.

/** What the editor hands its submit adapter. */
export interface BountySubmitProps {
  /** Sends the form: `update_bounties`, with what was sent noted. */
  action: FormAction<UpdateBountiesData>;
  /** The Save button's words, e.g. "Save 2 changes". */
  label: string;
  /** False while nothing changed or a field marked Required is blank. */
  canSave: boolean;
  /** Called once per answer (never for the kiosk's "enter your PIN"). */
  onResult: (result: ActionResult<UpdateBountiesData>) => void;
  /** The rows, and the hidden field the changes travel in. */
  fields: ReactNode;
  /** How many rows changed, or what to fill in first. */
  status: ReactNode;
  /** The last answer's sentence, if it failed. */
  error: ReactNode;
  /** The button beside Save: Discard, or Close with nothing to discard. */
  discard: { label: string; disabled: boolean; onClick: () => void };
}

export interface BountySubmit {
  render: (props: BountySubmitProps) => ReactNode;
}

/** The admin page: a plain form; its session attests itself. */
export const hubSubmit: BountySubmit = {
  render: (props) => <HubSubmitForm {...props} />,
};

/** The kitchen screen: AttestedForm, with `pinLabel` over the PIN pad. */
export function kioskSubmit(pinLabel: string): BountySubmit {
  return {
    render: (props) => <KioskSubmitForm pinLabel={pinLabel} {...props} />,
  };
}

function HubSubmitForm({
  action,
  label,
  canSave,
  onResult,
  fields,
  status,
  error,
  discard,
}: BountySubmitProps) {
  const { state, formAction, pending, requestId } = useActionForm(action);
  useEffect(() => {
    if (state) onResult(state);
    // Once per answer: `onResult` is a new function on every render.
  }, [state]);
  return (
    <form
      action={formAction}
      noValidate
      className="flex flex-col gap-4"
      data-testid="bounty-bulk-editor"
      // Enter in a row's field submits nothing while it cannot save.
      onSubmit={(e) => {
        if (!canSave) e.preventDefault();
      }}
    >
      <input type="hidden" name="requestId" value={requestId} />
      {fields}
      {status}
      {error}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !canSave}>
          {pending ? "Saving..." : label}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || discard.disabled}
          onClick={discard.onClick}
        >
          {discard.label}
        </Button>
      </div>
    </form>
  );
}

function KioskSubmitForm({
  pinLabel,
  action,
  label,
  canSave,
  onResult,
  fields,
  status,
  error,
  discard,
}: BountySubmitProps & { pinLabel: string }) {
  return (
    <div data-testid="bounty-bulk-editor">
      <AttestedForm
        action={action}
        label={label}
        pinLabel={pinLabel}
        onResult={onResult}
        disabled={!canSave}
        fields={fields}
        // Always in view at the bottom of the page, with what is wrong
        // above its buttons, so the admin never scrolls to the end to
        // save or to read why not. It spans the Card's padding, and its
        // right end stays clear of Baumy, who stands over the footer's
        // corner. It sits flush on the footer: the kiosk page's scroll
        // box keeps 56px of padding under its content (pb-14, KioskFrame),
        // and a sticky box stops that far above the bottom, so a bottom
        // of -56px takes it down to the edge, with no rows showing under it.
        // There Baumy's head rises into the bar's right end, so the
        // buttons keep 176px (pr-44) clear of it.
        bar={{
          testId: "bulk-save-bar",
          className:
            "sticky -bottom-14 z-20 -mx-4 grid grid-cols-2 gap-3 border-t-4 border-bm-line bg-bm-bg py-3 pr-44 pl-4 sm:-mx-6 sm:pl-6",
          extra: (
            <>
              <Button
                type="button"
                size="kiosk"
                variant="secondary"
                disabled={discard.disabled}
                onClick={discard.onClick}
              >
                {discard.label}
              </Button>
              <div className="order-first col-span-2 flex flex-col gap-2">
                {status}
                {error}
              </div>
            </>
          ),
        }}
      />
    </div>
  );
}
