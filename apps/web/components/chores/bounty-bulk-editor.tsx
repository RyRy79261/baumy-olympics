"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  CHORE_NAME_MAX,
  COOLDOWN_HOURS_MAX,
  EFFORT_FACTOR_MAX,
  EFFORT_FACTOR_MIN,
} from "@baumy/types";
import {
  BountyGlyph,
  Button,
  Field,
  FormMessage,
  Input,
  Select,
  cx,
} from "@baumy/ui";
import { AttestedForm } from "@/components/kiosk/attested-form";
import { useActionForm, type FormAction } from "@/components/use-action-form";
import type { ActionResult } from "@/lib/actions/result";
import type { UpdateBountiesData } from "@/lib/actions/update-bounties";
import {
  CHANGES_FIELD,
  changeOf,
  changesOf,
  draftOf,
  rowErrors,
  saveLabel,
  type BountyChangeInput,
  type BountyDraft,
  type BountyField,
  type BulkBounty,
} from "@/lib/chores/bulk-edit";
import { toast } from "@/lib/ui/toast";

// Mass editing of bounties (issue #175, SPEC §12 decision 31): one editable
// row per bounty, change as many as you like, then one Save that sends them
// all to `update_bounties`, which saves all of them or none. Changed rows are
// framed in amber and say "Changed". The admin page sends it with its
// session; the kitchen screen (`pinLabel`) wraps it in AttestedForm, so the
// picked admin's PIN goes with the one save.

export interface BulkEditorBounty extends BulkBounty {
  sprite: string;
}

type Errors = Partial<Record<BountyField, string[]>>;

export function BountyBulkEditor({
  bounties,
  action,
  pinLabel,
  onClose,
}: {
  bounties: readonly BulkEditorBounty[];
  action: FormAction<UpdateBountiesData>;
  /** The kitchen screen: the PIN pad's title, e.g. "Ryan's PIN". */
  pinLabel?: string;
  /** The admin page: back to its list, after a save or Close. */
  onClose?: () => void;
}) {
  const kiosk = pinLabel !== undefined;
  const [drafts, setDrafts] = useState<Record<string, BountyDraft>>({});
  const [result, setResult] = useState<ActionResult<UpdateBountiesData> | null>(
    null,
  );
  const [sent, setSent] = useState<BountyChangeInput[]>([]);
  const changes = useMemo(
    () => changesOf(bounties, drafts),
    [bounties, drafts],
  );
  const count = changes.length;
  const errors = rowErrors(result, sent);

  const send: FormAction<UpdateBountiesData> = async (prev, form) => {
    const raw = form.get(CHANGES_FIELD);
    setSent(typeof raw === "string" ? JSON.parse(raw) : []);
    return action(prev, form);
  };

  const onResult = (r: ActionResult<UpdateBountiesData>) => {
    setResult(r);
    if (!r.ok) return;
    const n = r.data.changed.length;
    toast.success(`Saved ${n} ${n === 1 ? "bounty" : "bounties"}.`);
    setDrafts({});
    onClose?.();
  };

  const discard = () => {
    setDrafts({});
    setResult(null);
    if (count === 0) onClose?.();
  };

  const update = (b: BulkBounty, patch: Partial<BountyDraft>) =>
    setDrafts((all) => ({
      ...all,
      [b.id]: { ...(all[b.id] ?? draftOf(b)), ...patch },
    }));

  const fields = (
    <>
      <input
        type="hidden"
        name={CHANGES_FIELD}
        value={JSON.stringify(changes)}
      />
      {bounties.length === 0 ? (
        <p className="text-base text-bm-muted">There are no bounties yet.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Bounties">
          {bounties.map((b) => (
            <BulkRow
              key={b.id}
              bounty={b}
              draft={drafts[b.id] ?? draftOf(b)}
              changed={Boolean(drafts[b.id] && changeOf(b, drafts[b.id]!))}
              errors={errors[b.id] ?? {}}
              kiosk={kiosk}
              onChange={(patch) => update(b, patch)}
            />
          ))}
        </ul>
      )}
    </>
  );

  // A failure about a field shows under it; any other, here.
  const message =
    result && !result.ok && Object.keys(errors).length === 0
      ? result.message
      : result && !result.ok
        ? "Some rows need fixing; see the red notes."
        : null;
  const status = (
    <p className="text-base text-bm-muted" aria-live="polite">
      {count === 0
        ? "No changes yet."
        : `${count} ${count === 1 ? "bounty" : "bounties"} changed, not saved yet.`}
    </p>
  );

  if (kiosk) {
    return (
      <div className="flex flex-col gap-4" data-testid="bounty-bulk-editor">
        <AttestedForm
          action={send}
          label={saveLabel(count)}
          pinLabel={pinLabel}
          onResult={onResult}
          disabled={count === 0}
          fields={
            <>
              {fields}
              {status}
              {message ? (
                <FormMessage tone="error">{message}</FormMessage>
              ) : null}
            </>
          }
        />
        <Button
          type="button"
          size="kiosk"
          variant="secondary"
          disabled={count === 0}
          onClick={discard}
        >
          Discard
        </Button>
      </div>
    );
  }
  return (
    <HubForm
      action={send}
      count={count}
      onResult={onResult}
      onDiscard={discard}
      closeLabel={onClose && count === 0 ? "Close" : "Discard"}
      message={message}
      status={status}
    >
      {fields}
    </HubForm>
  );
}

/** The admin page's form: its session attests itself. */
function HubForm({
  action,
  count,
  onResult,
  onDiscard,
  closeLabel,
  message,
  status,
  children,
}: {
  action: FormAction<UpdateBountiesData>;
  count: number;
  onResult: (r: ActionResult<UpdateBountiesData>) => void;
  onDiscard: () => void;
  closeLabel: string;
  message: string | null;
  status: ReactNode;
  children: ReactNode;
}) {
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
    >
      <input type="hidden" name="requestId" value={requestId} />
      {children}
      {status}
      {message ? <FormMessage tone="error">{message}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || count === 0}>
          {pending ? "Saving..." : saveLabel(count)}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || (closeLabel === "Discard" && count === 0)}
          onClick={onDiscard}
        >
          {closeLabel}
        </Button>
      </div>
    </form>
  );
}

/** One bounty's row: every setting, in a grid that wraps on narrow screens. */
function BulkRow({
  bounty: b,
  draft: d,
  changed,
  errors,
  kiosk,
  onChange,
}: {
  bounty: BulkEditorBounty;
  draft: BountyDraft;
  changed: boolean;
  errors: Errors;
  kiosk: boolean;
  onChange: (patch: Partial<BountyDraft>) => void;
}) {
  const id = (f: string) => `bulk-${b.id}-${f}`;
  const control = kiosk ? "min-h-14 text-xl" : undefined;
  return (
    <li
      data-testid={`bulk-bounty-${b.name}`}
      data-changed={changed ? "true" : undefined}
      className={cx(
        "pixel-frame flex flex-col gap-3 p-3",
        changed
          ? "bg-bm-amber/10 [--pf:var(--color-bm-amber)]"
          : "bg-bm-ink/40",
      )}
    >
      <div className="flex items-center gap-3">
        <BountyGlyph sprite={b.sprite} kind={d.kind} size="small" />
        <span className="font-semibold">{b.name}</span>
        {d.archived ? (
          <span className="text-sm text-bm-muted">Archived</span>
        ) : null}
        {changed ? (
          <span className="ml-auto font-label text-sm font-bold tracking-wide text-bm-amber uppercase">
            Changed
          </span>
        ) : null}
      </div>
      <div
        className={cx(
          "grid gap-3",
          kiosk ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-8",
        )}
      >
        <div className="col-span-2">
          <Field id={id("name")} label="Name" errors={errors.name}>
            {(c) => (
              <Input
                {...c}
                kiosk={kiosk}
                maxLength={CHORE_NAME_MAX}
                value={d.name}
                onChange={(e) => onChange({ name: e.currentTarget.value })}
              />
            )}
          </Field>
        </div>
        <Field id={id("status")} label="Status" errors={errors.archived}>
          {(c) => (
            <Select
              {...c}
              className={control}
              value={d.archived ? "archived" : "active"}
              onChange={(e) =>
                onChange({ archived: e.currentTarget.value === "archived" })
              }
            >
              <option value="active">On the board</option>
              <option value="archived">Archived</option>
            </Select>
          )}
        </Field>
        <Field id={id("kind")} label="Kind" errors={errors.kind}>
          {(c) => (
            <Select
              {...c}
              className={control}
              value={d.kind}
              onChange={(e) =>
                onChange({
                  kind: e.currentTarget.value as BountyDraft["kind"],
                })
              }
            >
              <option value="maintenance">Maintenance</option>
              <option value="consumable">Consumable</option>
            </Select>
          )}
        </Field>
        <Field id={id("points")} label="Points" errors={errors.points}>
          {(c) => (
            <Input
              {...c}
              kiosk={kiosk}
              type="number"
              inputMode="numeric"
              min={BASE_POINTS_MIN}
              max={BASE_POINTS_MAX}
              value={d.points}
              onChange={(e) => onChange({ points: e.currentTarget.value })}
            />
          )}
        </Field>
        <Field
          id={id("cooldown")}
          label="Cooldown (h)"
          errors={errors.cooldownHours}
        >
          {(c) => (
            <Input
              {...c}
              kiosk={kiosk}
              type="number"
              inputMode="decimal"
              min={0}
              max={COOLDOWN_HOURS_MAX}
              step="any"
              value={d.cooldownHours}
              onChange={(e) =>
                onChange({ cooldownHours: e.currentTarget.value })
              }
            />
          )}
        </Field>
        <Field id={id("proof")} label="Photo proof" errors={errors.proofMode}>
          {(c) => (
            <Select
              {...c}
              className={control}
              value={d.proofMode}
              onChange={(e) =>
                onChange({
                  proofMode: e.currentTarget.value as BountyDraft["proofMode"],
                })
              }
            >
              <option value="none">None</option>
              <option value="optional">Optional</option>
              <option value="required">Required</option>
            </Select>
          )}
        </Field>
        <Field
          id={id("effort")}
          label="Effort (%)"
          errors={errors.effortFactorPct}
        >
          {(c) => (
            <Input
              {...c}
              kiosk={kiosk}
              type="number"
              inputMode="numeric"
              min={EFFORT_FACTOR_MIN}
              max={EFFORT_FACTOR_MAX}
              value={d.effortFactorPct}
              onChange={(e) =>
                onChange({ effortFactorPct: e.currentTarget.value })
              }
            />
          )}
        </Field>
      </div>
    </li>
  );
}
