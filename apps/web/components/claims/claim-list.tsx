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
import type { ClaimView } from "@/lib/actions/get-pending-confirmations";
import type { ActionResult } from "@/lib/actions/result";
import { claimStatusLine, claimTitle } from "@/lib/claims/view";
import { toast } from "@/lib/ui/toast";

// "Needs your OK" (SPEC §4.3): open claims, each with exactly the buttons
// `get_pending_confirmations` says would work for the member acting. The
// same list is the phone's /inbox and the kiosk's banner. Every button is an
// `AttestedForm`: on the kiosk it asks for the acting member's PIN, on a
// phone the session vouches.
//
// NEUTRAL PLACEHOLDER layout; issue #7 restyles it through packages/ui.

export interface ClaimActions {
  confirm: FormAction<ClaimEventData>;
  dispute: FormAction<ClaimEventData>;
  undo: FormAction<ClaimEventData>;
  withdraw: FormAction<ClaimEventData>;
  concede: FormAction<ClaimEventData>;
  /** Admins in the UI only. */
  resolve?: FormAction<ClaimEventData>;
}

function report<T>(success: (data: T) => string, after?: () => void) {
  return (result: ActionResult<T>) => {
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(success(result.data));
    after?.();
  };
}

function Hidden({ id }: { id: string }) {
  return <input type="hidden" name="completionId" value={id} />;
}

function DisputeForm({
  claim,
  action,
  kiosk,
  pinLabel,
}: {
  claim: ClaimView;
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
        action={action}
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
        onResult={report(() => `Disputed ${claim.choreName}.`)}
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
  claim: ClaimView;
  kiosk: boolean;
  pinLabel: string;
}) {
  const router = useRouter();
  const photo = useRef<Blob | null>(null);
  const [ready, setReady] = useState(false);
  const [action] = useState(() =>
    photoUploadAction<AttachPhotoData>(() => photo.current, kiosk),
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
          onResult={report<AttachPhotoData>(
            () => `Photo added to ${claim.choreName}.`,
            () => router.refresh(),
          )}
        />
      ) : null}
    </div>
  );
}

function ClaimCard({
  claim,
  actions,
  kiosk,
  pinLabel,
}: {
  claim: ClaimView;
  actions: ClaimActions;
  kiosk: boolean;
  pinLabel: string;
}) {
  const title = claimTitle(claim);
  const can = claim.can;
  const simple = (
    key: "confirm" | "undo" | "withdraw" | "concede",
    label: string,
    done: string,
  ) => (
    <AttestedForm
      action={actions[key]}
      label={label}
      pinLabel={pinLabel}
      fields={<Hidden id={claim.completionId} />}
      onResult={report(() => done)}
    />
  );
  return (
    <Card
      title={title}
      data-testid={`claim-${claim.choreName}`}
      data-status={claim.status}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-700">{claimStatusLine(claim)}</p>
        {claim.photoUrl ? (
          <ProofPhoto
            src={claim.photoUrl}
            alt={`Proof photo for ${claim.choreName}`}
          />
        ) : null}
        <div className="flex flex-wrap items-start gap-3">
          {can.confirm
            ? simple("confirm", "Confirm", `Confirmed: ${title}.`)
            : null}
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
                action={actions.resolve}
                label="Uphold"
                pinLabel={pinLabel}
                fields={
                  <>
                    <Hidden id={claim.completionId} />
                    <input type="hidden" name="outcome" value="uphold" />
                  </>
                }
                onResult={report(() => `Upheld ${title}.`)}
              />
              <AttestedForm
                action={actions.resolve}
                label="Void"
                pinLabel={pinLabel}
                fields={
                  <>
                    <Hidden id={claim.completionId} />
                    <input type="hidden" name="outcome" value="void" />
                  </>
                }
                onResult={report(() => `Voided ${title}.`)}
              />
            </>
          ) : null}
        </div>
        {can.attachPhoto ? (
          <PhotoForm claim={claim} kiosk={kiosk} pinLabel={pinLabel} />
        ) : null}
      </div>
    </Card>
  );
}

export function ClaimList({
  claims,
  actions,
  kiosk = false,
  pinLabel,
  empty,
}: {
  claims: ClaimView[];
  actions: ClaimActions;
  kiosk?: boolean;
  /** What the PIN pad is for, e.g. "Ryan's PIN". */
  pinLabel: string;
  empty: string;
}) {
  if (claims.length === 0) {
    return <p className="text-sm text-neutral-600">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {claims.map((c) => (
        <li key={c.completionId}>
          <ClaimCard
            claim={c}
            actions={actions}
            kiosk={kiosk}
            pinLabel={pinLabel}
          />
        </li>
      ))}
    </ul>
  );
}
