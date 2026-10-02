"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, Card, Field, ProofPhoto, Textarea } from "@baumy/ui";
import { AttestedForm } from "@/components/kiosk/attested-form";
import { PhotoPicker } from "@/components/photos/photo-picker";
import { photoUploadAction } from "@/components/photos/upload-action";
import type { FormAction } from "@/components/use-action-form";
import type { AttachPhotoData } from "@/lib/actions/attach-completion-photo";
import type { ClaimEventData } from "@/lib/actions/confirmations";
import type {
  ActivityChoreView,
  ActivityView,
} from "@/lib/actions/get-activity";
import type { WeightDecisionData } from "@/lib/actions/weights";
import {
  choreStatusLine,
  choreTitle,
  entryLine,
  entryTime,
} from "@/lib/activity/view";
import { PIN_PROMPT_CODES } from "@/lib/kiosk/constants";
import { toast } from "@/lib/ui/toast";

// The activity log (issue #150, SPEC §4.3): what happened in the house,
// newest first, from `get_activity`. A logged chore carries exactly the
// buttons the read says would work for the member acting (Dispute while its
// window is open, Withdraw, Concede, Undo, a photo; an admin's ruling on the
// phone), and a scheduled points change its Veto where the surface offers
// it. There is no confirming (§12 decision 29). Every button is an
// `AttestedForm`: on the kiosk only Dispute asks for the acting member's PIN
// (decision 27), and a member with no PIN is told so with a QR code to
// Settings; on a phone the session vouches.
//
// Layout only: the look is the pixel kit's (packages/ui, issue #64).

export interface ActivityActions {
  dispute: FormAction<ClaimEventData>;
  undo: FormAction<ClaimEventData>;
  withdraw: FormAction<ClaimEventData>;
  concede: FormAction<ClaimEventData>;
  /** Admins in the UI only. */
  resolve?: FormAction<ClaimEventData>;
  /** Where `veto_weight` is offered (the phone). */
  veto?: FormAction<WeightDecisionData>;
}

/**
 * The action, reporting its outcome through a toast as soon as it answers.
 * Not through `AttestedForm`'s `onResult`: an entry that changes loses the
 * very button that changed it when the page re-renders, before an effect in
 * that button's form could run. A PIN prompt is the form's own business.
 */
function reporting<T>(
  action: FormAction<T>,
  success: (data: T) => string,
  after?: () => void,
): FormAction<T> {
  return async (prev, form) => {
    const result = await action(prev, form);
    if (result.ok) {
      toast.success(success(result.data));
      after?.();
    } else if (!PIN_PROMPT_CODES.has(result.code)) {
      toast.error(result.message);
    }
    return result;
  };
}

/** The form reports through `reporting`; nothing is shown inline. */
const QUIET = () => {};

function Hidden({ id }: { id: string }) {
  return <input type="hidden" name="completionId" value={id} />;
}

function DisputeForm({
  claim,
  action,
  kiosk,
  pinLabel,
}: {
  claim: ActivityChoreView;
  action: FormAction<ClaimEventData>;
  kiosk: boolean;
  pinLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // Controlled, so a PIN prompt's second send still carries it.
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button
        variant="secondary"
        size={kiosk ? "kiosk" : "default"}
        onClick={() => setOpen(true)}
      >
        Dispute
      </Button>
    );
  }
  const fieldId = `reason-${claim.completionId}`;
  return (
    <div className="flex flex-col gap-2">
      <AttestedForm
        action={reporting(action, () => `Disputed ${claim.choreName}.`)}
        label="Send dispute"
        pinLabel={pinLabel}
        disabled={reason.trim() === ""}
        fields={
          <>
            <Hidden id={claim.completionId} />
            <Field id={fieldId} label="Why was it not done?">
              {(control) => (
                <Textarea
                  {...control}
                  name="reason"
                  kiosk={kiosk}
                  maxLength={280}
                  value={reason}
                  onChange={(e) => setReason(e.currentTarget.value)}
                />
              )}
            </Field>
          </>
        }
        onResult={QUIET}
      />
      <Button
        variant="ghost"
        size={kiosk ? "kiosk" : "default"}
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </div>
  );
}

function PhotoForm({
  claim,
  kiosk,
  pinLabel,
}: {
  claim: ActivityChoreView;
  kiosk: boolean;
  pinLabel: string;
}) {
  const router = useRouter();
  const photo = useRef<Blob | null>(null);
  const [ready, setReady] = useState(false);
  const [action] = useState(() =>
    reporting(
      photoUploadAction<AttachPhotoData>(() => photo.current, kiosk),
      () => `Photo added to ${claim.choreName}.`,
      () => router.refresh(),
    ),
  );
  return (
    <div className="flex flex-col gap-2">
      <PhotoPicker
        kiosk={kiosk}
        onPhoto={(p) => {
          photo.current = p;
          setReady(p !== null);
        }}
      />
      {ready ? (
        <AttestedForm
          action={action}
          label="Upload photo"
          pinLabel={pinLabel}
          fields={<Hidden id={claim.completionId} />}
          onResult={QUIET}
        />
      ) : null}
    </div>
  );
}

function ChoreEntry({
  claim,
  actions,
  kiosk,
  pinLabel,
}: {
  claim: ActivityChoreView;
  actions: ActivityActions;
  kiosk: boolean;
  pinLabel: string;
}) {
  const title = choreTitle(claim);
  const can = claim.can;
  // No empty button row (and no gap for it) when nothing applies.
  const anyButton =
    can.dispute ||
    can.withdraw ||
    can.concede ||
    can.undo ||
    (can.resolve && actions.resolve !== undefined);
  const simple = (
    key: "undo" | "withdraw" | "concede",
    label: string,
    done: string,
  ) => (
    <AttestedForm
      action={reporting(actions[key], () => done)}
      label={label}
      pinLabel={pinLabel}
      fields={<Hidden id={claim.completionId} />}
      onResult={QUIET}
    />
  );
  return (
    <Card
      title={title}
      data-testid={`activity-chore-${claim.choreName}`}
      data-status={claim.status}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-bm-muted">
          <time dateTime={claim.at}>{entryTime(claim)}</time>
          {" · "}
          {choreStatusLine(claim)}
        </p>
        {claim.photoUrl ? (
          <ProofPhoto
            src={claim.photoUrl}
            alt={`Proof photo for ${claim.choreName}`}
          />
        ) : null}
        {anyButton ? (
          <div className="flex flex-wrap items-start gap-3">
            {can.dispute ? (
              <DisputeForm
                claim={claim}
                action={actions.dispute}
                kiosk={kiosk}
                pinLabel={pinLabel}
              />
            ) : null}
            {can.withdraw
              ? simple(
                  "withdraw",
                  "Withdraw dispute",
                  `Dispute on ${claim.choreName} withdrawn.`,
                )
              : null}
            {can.concede
              ? simple("concede", "Concede", `Conceded ${claim.choreName}.`)
              : null}
            {can.undo
              ? simple("undo", "Undo", `Undid ${claim.choreName}.`)
              : null}
            {can.resolve && actions.resolve ? (
              <>
                <AttestedForm
                  action={reporting(actions.resolve, () => `Upheld ${title}.`)}
                  label="Uphold"
                  pinLabel={pinLabel}
                  fields={
                    <>
                      <Hidden id={claim.completionId} />
                      <input type="hidden" name="outcome" value="uphold" />
                    </>
                  }
                  onResult={QUIET}
                />
                <AttestedForm
                  action={reporting(actions.resolve, () => `Voided ${title}.`)}
                  label="Void"
                  pinLabel={pinLabel}
                  fields={
                    <>
                      <Hidden id={claim.completionId} />
                      <input type="hidden" name="outcome" value="void" />
                    </>
                  }
                  onResult={QUIET}
                />
              </>
            ) : null}
          </div>
        ) : null}
        {can.attachPhoto ? (
          <PhotoForm claim={claim} kiosk={kiosk} pinLabel={pinLabel} />
        ) : null}
      </div>
    </Card>
  );
}

function OtherEntry({
  entry,
  actions,
  pinLabel,
}: {
  entry: Exclude<ActivityView, ActivityChoreView>;
  actions: ActivityActions;
  pinLabel: string;
}) {
  const veto =
    entry.kind === "points" && entry.canVeto && actions.veto
      ? actions.veto
      : null;
  return (
    <div
      data-testid={`activity-${entry.kind}-${entry.choreName}`}
      data-event={entry.kind === "points" ? entry.event : undefined}
      className="flex flex-wrap items-center justify-between gap-3 px-1"
    >
      <p className="text-sm">
        <time dateTime={entry.at} className="text-bm-muted">
          {entryTime(entry)}
        </time>
        {" · "}
        {entryLine(entry)}
      </p>
      {veto && entry.kind === "points" ? (
        <AttestedForm
          action={reporting(
            veto,
            () => `Vetoed. ${entry.choreName}'s points stay as they are.`,
          )}
          label="Veto"
          variant="danger"
          pinLabel={pinLabel}
          fields={
            <input
              type="hidden"
              name="suggestionId"
              value={entry.suggestionId}
            />
          }
          onResult={QUIET}
        />
      ) : null}
    </div>
  );
}

export function ActivityLog({
  entries,
  actions,
  kiosk = false,
  pinLabel,
}: {
  entries: ActivityView[];
  actions: ActivityActions;
  kiosk?: boolean;
  /** What the PIN pad is for, e.g. "Ryan's PIN". */
  pinLabel: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-bm-muted">
        Nothing has happened in the last 30 days.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-4" data-testid="activity-log">
      {entries.map((e) => (
        <li key={e.id}>
          {e.kind === "chore" ? (
            <ChoreEntry
              claim={e}
              actions={actions}
              kiosk={kiosk}
              pinLabel={pinLabel}
            />
          ) : (
            <OtherEntry entry={e} actions={actions} pinLabel={pinLabel} />
          )}
        </li>
      ))}
    </ol>
  );
}
