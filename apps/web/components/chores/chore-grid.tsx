"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BountyList,
  BountyRow,
  ChoiceGroup,
  Dialog,
  ScorePop,
  StreakBrokenBanner,
  TabLabel,
  tabClass,
  type TabAccent,
} from "@baumy/ui";
import { AttestedForm } from "@/components/kiosk/attested-form";
import { PhotoPicker } from "@/components/photos/photo-picker";
import { photoUploadAction } from "@/components/photos/upload-action";
import type { FormAction } from "@/components/use-action-form";
import type { ChoreView } from "@/lib/actions/list-chores";
import type { LogCompletionData } from "@/lib/actions/log-completion";
import type { ActionResult } from "@/lib/actions/result";
import {
  bountyCounts,
  filterBounties,
  parseBountyFilter,
  previewFor,
  sortBounties,
  statusLabel,
  streakLabel,
  type BountyFilter,
} from "@/lib/chores/view";
import { announceScore } from "@/lib/ui/scored";
import { toast } from "@/lib/ui/toast";

// The bounty board (SPEC §3.2; ADR 0005 §2): chores presented as bounties,
// the same on the phone (/chores) and on the kiosk (acting as the member
// whose avatar was tapped). The urgent ones come first; one row of tabs
// narrows the board to the urgent, the new, or one kind. Tapping a row opens
// a sheet with the preview ("+25, streak 2") and a confirm button. Logging
// for someone else is a choice in the sheet, and vouches for them; it needs
// no PIN on the kiosk (owner ruling 2026-10-02, issue #145). The form is
// still an AttestedForm, so a PIN would be asked if the gate ever wanted
// one.
//
// Outcomes: a floating "+N", a "STREAK BROKEN" banner when a streak ended,
// and a toast for a refusal (a cooldown says when to try again, in Berlin
// time). The page re-renders from the server action's revalidatePath.

export interface GridMember {
  id: string;
  displayName: string;
}

const POP_MS = 2500;

/** The board's tabs, in order, each with its accent (ADR 0005 §8). */
const TABS: { filter: BountyFilter; label: string; accent: TabAccent }[] = [
  { filter: "all", label: "All", accent: "violet" },
  { filter: "urgent", label: "Urgent", accent: "red" },
  { filter: "new", label: "New", accent: "yellow" },
  { filter: "consumable", label: "Consumables", accent: "amber" },
  { filter: "maintenance", label: "Maintenance", accent: "teal" },
];

/** What the board says when a tab keeps nothing. */
const EMPTY: Record<BountyFilter, string> = {
  all: "",
  urgent: "Nothing is urgent. Baumy approves.",
  new: "No bounties added in the last 3 days.",
  consumable: "No consumables to buy or refill.",
  maintenance: "No maintenance bounties.",
};
const BANNER_MS = 6000;

export function ChoreGrid({
  chores,
  members,
  actorId,
  kiosk = false,
  action,
  initialOpenId,
  rowAction,
}: {
  chores: ChoreView[];
  members: GridMember[];
  /** The member acting: the signed-in one, or the kiosk's picked avatar. */
  actorId: string;
  kiosk?: boolean;
  action: FormAction<LogCompletionData>;
  /**
   * A chore whose sheet opens at once: the dashboard's "I'll do it"
   * (`/kiosk/chores?chore=<id>`, ADR 0005 §1). Ignored if it is not listed.
   */
  initialOpenId?: string;
  /** A control beside each row: an admin's Edit on /chores (issue #109). */
  rowAction?: (chore: ChoreView) => ReactNode;
}) {
  // The tab lives in the address (`?show=`): the hub's Urgent and New tiles
  // link to theirs, and a refresh keeps it. A tap shows the tab at once and
  // writes the address without a server round trip; a navigation (a tile's
  // link, back) brings the address's tab in.
  const shownInUrl = parseBountyFilter(useSearchParams().get("show"));
  const [filter, setFilter] = useState<BountyFilter>(shownInUrl);
  useEffect(() => setFilter(shownInUrl), [shownInUrl]);
  const [openId, setOpenId] = useState<string | null>(() =>
    chores.some((c) => c.id === initialOpenId && c.state !== "unavailable")
      ? initialOpenId!
      : null,
  );
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
      announceScore(d.totalPts);
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

  /**
   * Choose a tab and keep it in the address. `history.replaceState` with a
   * null state is the form Next.js keeps its router in step with, so the
   * re-render after logging a chore keeps ?show= and nothing is fetched or
   * remounted (an open sheet stays open).
   */
  function choose(next: BountyFilter) {
    setFilter(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "all") params.delete("show");
    else params.set("show", next);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }

  const counts = bountyCounts(chores);
  const shown = filterBounties(sortBounties(chores), filter);

  if (chores.length === 0) {
    return (
      <p className="text-sm text-bm-muted">
        No bounties yet. An admin can add them under Edit chores.
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

      <div
        role="group"
        aria-label="Show"
        className="mb-2 flex flex-wrap gap-2"
        data-testid="bounty-tabs"
      >
        {TABS.map((t) => {
          const on = t.filter === filter;
          return (
            <button
              key={t.filter}
              type="button"
              aria-pressed={on}
              data-tab={t.filter}
              className={tabClass(on, t.accent, kiosk)}
              onClick={() => choose(t.filter)}
            >
              <TabLabel
                label={t.label}
                count={counts[t.filter]}
                on={on}
                accent={t.accent}
              />
            </button>
          );
        })}
      </div>

      <BountyList aria-label="Bounties">
        {shown.map((c) => (
          // Below `sm` the row action (an admin's Edit) gets its own line
          // under the row, so a phone keeps the whole bounty name (#115).
          <li
            key={c.id}
            data-testid={`chore-${c.name}`}
            className={
              rowAction
                ? "flex flex-col gap-2 sm:flex-row sm:items-center"
                : undefined
            }
          >
            <BountyRow
              name={c.name}
              sprite={c.sprite}
              kind={c.kind}
              points={c.basePoints}
              streak={streakLabel(c)}
              status={statusLabel(c)}
              urgent={c.urgent}
              isNew={c.isNew}
              kiosk={kiosk}
              disabled={c.state === "unavailable"}
              className={rowAction ? "min-w-0 sm:flex-1" : undefined}
              onClick={() => {
                setDoneBy(actorId);
                choosePhoto(null);
                setOpenId(c.id);
              }}
            />
            {rowAction?.(c)}
          </li>
        ))}
      </BountyList>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-xl text-bm-muted">
          {EMPTY[filter]}
        </p>
      ) : null}

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
                {`You are vouching that ${nameOf(doneBy)} did it.`}
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
