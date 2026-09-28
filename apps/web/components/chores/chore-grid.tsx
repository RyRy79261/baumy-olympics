"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ChoiceGroup,
  ChoreTile,
  Dialog,
  ScorePop,
  StreakBrokenBanner,
} from "@baumy/ui";
import { AttestedForm } from "@/components/kiosk/attested-form";
import { PhotoPicker } from "@/components/photos/photo-picker";
import { photoUploadAction } from "@/components/photos/upload-action";
import type { FormAction } from "@/components/use-action-form";
import type { ChoreView } from "@/lib/actions/list-chores";
import type { LogCompletionData } from "@/lib/actions/log-completion";
import type { ActionResult } from "@/lib/actions/result";
import { previewFor, statusLabel, streakLabel } from "@/lib/chores/view";
import { toast } from "@/lib/ui/toast";

// The chore grid (SPEC §3.2), the same on the phone (/chores) and on the
// kiosk (acting as the member whose avatar was tapped). Tapping a tile opens
// a sheet with the preview ("+25, streak 2") and a confirm button. Logging
// for someone else is a choice in the sheet; on the kiosk it asks for the
// LOGGER's PIN (AttestedForm), on a phone the session vouches.
//
// Outcomes: a floating "+N", a "STREAK BROKEN" banner when a streak ended,
// and a toast for a refusal (a cooldown says when to try again, in Berlin
// time). The page re-renders from the server action's revalidatePath.

export interface GridMember {
  id: string;
  displayName: string;
}

const POP_MS = 2500;
const BANNER_MS = 6000;

export function ChoreGrid({
  chores,
  members,
  actorId,
  kiosk = false,
  action,
}: {
  chores: ChoreView[];
  members: GridMember[];
  /** The member acting: the signed-in one, or the kiosk's picked avatar. */
  actorId: string;
  kiosk?: boolean;
  action: FormAction<LogCompletionData>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [doneBy, setDoneBy] = useState(actorId);
  const [pop, setPop] = useState<{ key: number; points: number } | null>(null);
  const [broken, setBroken] = useState<LogCompletionData | null>(null);
  const router = useRouter();
  const photo = useRef<Blob | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  // One form action for the sheet: the upload route when a photo is picked,
  // else the page's server action. Read through refs, so it never goes stale.
  const serverAction = useRef(action);
  serverAction.current = action;
  const [logAction] = useState<FormAction<LogCompletionData>>(() => {
    const upload = photoUploadAction<LogCompletionData>(
      () => photo.current,
      kiosk,
    );
    const send: FormAction<LogCompletionData> = (prev, form) =>
      photo.current ? upload(prev, form) : serverAction.current(prev, form);
    return send;
  });

  useEffect(() => {
    if (!pop) return;
    const timer = setTimeout(() => setPop(null), POP_MS);
    return () => clearTimeout(timer);
  }, [pop]);
  useEffect(() => {
    if (!broken) return;
    const timer = setTimeout(() => setBroken(null), BANNER_MS);
    return () => clearTimeout(timer);
  }, [broken]);

  const open = chores.find((c) => c.id === openId) ?? null;
  const preview = open ? previewFor(open, doneBy, actorId) : null;
  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? "someone";

  function choosePhoto(p: Blob | null) {
    photo.current = p;
    setHasPhoto(p !== null);
  }

  function onResult(result: ActionResult<LogCompletionData>) {
    setOpenId(null);
    const sentPhoto = photo.current !== null;
    choosePhoto(null);
    if (sentPhoto && result.ok) router.refresh();
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const d = result.data;
    if (d.totalPts !== null) {
      setPop({ key: Date.now(), points: d.totalPts });
      toast.success(
        `Logged ${d.choreName} for ${d.doneByName}: +${d.totalPts}.`,
      );
    } else {
      toast.success(
        `Logged ${d.choreName}. It counts once someone else confirms it.`,
      );
    }
    setBroken(d.brokenLen !== null ? d : null);
  }

  if (chores.length === 0) {
    return (
      <p className="text-sm text-bm-muted">
        No chores yet. An admin can add them under Edit chores.
      </p>
    );
  }

  return (
    <>
      {broken && broken.brokenLen !== null ? (
        <div className="mb-4">
          <StreakBrokenBanner
            holderName={broken.brokenMemberName ?? "Someone"}
            length={broken.brokenLen}
            bonus={broken.breakPts ?? 0}
          />
        </div>
      ) : null}
      {pop ? <ScorePop key={pop.key} points={pop.points} /> : null}

      <ul
        className={
          kiosk
            ? "grid grid-cols-3 gap-3 xl:grid-cols-4"
            : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        }
        aria-label="Chores"
      >
        {chores.map((c) => (
          <li key={c.id} data-testid={`chore-${c.name}`}>
            <ChoreTile
              name={c.name}
              sprite={c.sprite}
              points={c.basePoints}
              streak={streakLabel(c)}
              status={statusLabel(c)}
              state={c.state}
              kiosk={kiosk}
              disabled={c.state === "unavailable"}
              onClick={() => {
                setDoneBy(actorId);
                choosePhoto(null);
                setOpenId(c.id);
              }}
            />
          </li>
        ))}
      </ul>

      <Dialog
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open ? `Log ${open.name}` : "Log a chore"}
      >
        {open ? (
          <div className="flex flex-col gap-4">
            {members.length > 1 ? (
              <ChoiceGroup
                legend="Who did it?"
                name="doneByChoice"
                kiosk={kiosk}
                value={doneBy}
                onChange={setDoneBy}
                options={members.map((m) => ({
                  value: m.id,
                  label:
                    m.id === actorId ? `${m.displayName} (me)` : m.displayName,
                }))}
              />
            ) : null}
            {preview ? (
              <div data-testid="log-preview" className="flex flex-col gap-1">
                <p className="text-3xl font-bold">{preview.headline}</p>
                {preview.breaks ? <p>{preview.breaks}</p> : null}
                {preview.pending ? (
                  <p className="text-sm text-bm-muted">{preview.pending}</p>
                ) : null}
              </div>
            ) : null}
            {doneBy !== actorId ? (
              <p className="text-sm text-bm-muted">
                {kiosk
                  ? `You are vouching that ${nameOf(doneBy)} did it, so your PIN is needed.`
                  : `You are vouching that ${nameOf(doneBy)} did it.`}
              </p>
            ) : null}
            {open.proofMode !== "none" ? (
              <div className="flex flex-col gap-1">
                <PhotoPicker
                  key={open.id}
                  kiosk={kiosk}
                  label={
                    open.proofMode === "required"
                      ? "Add a photo (required)"
                      : "Add a photo (optional)"
                  }
                  onPhoto={choosePhoto}
                />
                {open.proofMode === "required" && !hasPhoto ? (
                  <p className="text-sm text-bm-muted">
                    {open.name} needs a photo as proof.
                  </p>
                ) : null}
              </div>
            ) : null}
            <AttestedForm
              key={`${open.id}:${doneBy}`}
              action={logAction}
              disabled={open.proofMode === "required" && !hasPhoto}
              label="Log it"
              pinLabel={`${nameOf(actorId)}'s PIN`}
              fields={
                <>
                  <input type="hidden" name="choreId" value={open.id} />
                  {doneBy !== actorId ? (
                    <input type="hidden" name="doneBy" value={doneBy} />
                  ) : null}
                </>
              }
              onResult={onResult}
            />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
