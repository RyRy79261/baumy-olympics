"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BASE_POINTS_MAX, BASE_POINTS_MIN, CHORE_NAME_MAX } from "@baumy/types";
import {
  BountyGlyph,
  Button,
  Field,
  FormMessage,
  Input,
  Select,
  Slider,
  cx,
  withStop,
} from "@baumy/ui";
import { AttestedForm } from "@/components/kiosk/attested-form";
import { useActionForm, type FormAction } from "@/components/use-action-form";
import type { ActionResult } from "@/lib/actions/result";
import type { UpdateBountiesData } from "@/lib/actions/update-bounties";
import {
  CHANGES_FIELD,
  COOLDOWN_STOPS,
  EFFORT_STOPS,
  POINT_STOPS,
  blankErrors,
  changeOf,
  changesOf,
  cooldownText,
  effortText,
  pointsText,
  rowErrors,
  saveLabel,
  sliderValue,
  viewOf,
  type BountyChangeInput,
  type BountyDraft,
  type BountyField,
  type BulkBounty,
  type Touched,
} from "@/lib/chores/bulk-edit";
import { hoursField } from "@/lib/weights/view";
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

/**
 * The rows' controls name no form (no element has this id), so they belong
 * to none. React resets a form once its action answers (the kiosk's first,
 * PIN-less send does), and a reset puts a controlled list back on its first
 * option while the state, and so what is sent, still holds the edit. The
 * edits travel in the one hidden JSON field instead.
 */
const DETACHED = "bounty-bulk-editor-rows";

/** Server errors and the editor's own "Required." for one row, merged. */
function mergeErrors(a: Errors, b: Errors): Errors {
  const out: Errors = { ...a };
  for (const [k, v] of Object.entries(b) as [BountyField, string[]][]) {
    out[k] = [...(out[k] ?? []), ...v];
  }
  return out;
}

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
  // Only what the admin touched, per bounty (see `Touched`).
  const [touched, setTouched] = useState<Record<string, Touched>>({});
  const [result, setResult] = useState<ActionResult<UpdateBountiesData> | null>(
    null,
  );
  const [sent, setSent] = useState<BountyChangeInput[]>([]);
  const changes = useMemo(
    () => changesOf(bounties, touched),
    [bounties, touched],
  );
  const count = changes.length;
  const serverErrors = rowErrors(result, sent);
  const blanks = Object.fromEntries(
    bounties.map((b) => [b.id, blankErrors(b, touched[b.id] ?? {})]),
  );
  const hasBlanks = Object.values(blanks).some((e) => Object.keys(e).length);
  const canSave = count > 0 && !hasBlanks;

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
    setTouched({});
    onClose?.();
  };

  const discard = () => {
    setTouched({});
    setResult(null);
    if (count === 0) onClose?.();
  };

  // Any edit makes the last answer stale: its notes go until the next Save.
  const update = (b: BulkBounty, patch: Touched) => {
    setResult(null);
    setTouched((all) => ({ ...all, [b.id]: { ...all[b.id], ...patch } }));
  };

  // A field no longer touched: a slider back at the bounty's own value, or
  // Clear on one of a bounty with no points yet ("Not set" again).
  const clear = (b: BulkBounty, field: keyof Touched) => {
    setResult(null);
    setTouched((all) => {
      const row = { ...all[b.id] };
      delete row[field];
      return { ...all, [b.id]: row };
    });
  };

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
          {bounties.map((b) => {
            const t = touched[b.id];
            return (
              <BulkRow
                key={b.id}
                bounty={b}
                draft={viewOf(b, t)}
                touched={t}
                changed={Boolean(t && changeOf(b, t))}
                errors={mergeErrors(serverErrors[b.id] ?? {}, blanks[b.id]!)}
                kiosk={kiosk}
                onChange={(patch) => update(b, patch)}
                onClear={(field) => clear(b, field)}
              />
            );
          })}
        </ul>
      )}
    </>
  );

  // The action's sentence (a clash is also on its row); for bad fields,
  // where to look.
  const message =
    result && !result.ok
      ? result.code === "INVALID_INPUT"
        ? "Some rows need fixing; see the red notes."
        : result.message
      : null;
  const status = (
    <p className="text-base text-bm-muted" aria-live="polite">
      {hasBlanks
        ? "Fill in the fields marked Required."
        : count === 0
          ? "No changes yet."
          : `${count} ${count === 1 ? "bounty" : "bounties"} changed, not saved yet.`}
    </p>
  );
  const error = message ? (
    <FormMessage tone="error">{message}</FormMessage>
  ) : null;

  if (kiosk) {
    return (
      <div data-testid="bounty-bulk-editor">
        <AttestedForm
          action={send}
          label={saveLabel(count)}
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
                  disabled={count === 0}
                  onClick={discard}
                >
                  Discard
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
  return (
    <HubForm
      action={send}
      count={count}
      canSave={canSave}
      onResult={onResult}
      onDiscard={discard}
      closeLabel={onClose && count === 0 ? "Close" : "Discard"}
      error={error}
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
  canSave,
  onResult,
  onDiscard,
  closeLabel,
  error,
  status,
  children,
}: {
  action: FormAction<UpdateBountiesData>;
  count: number;
  canSave: boolean;
  onResult: (r: ActionResult<UpdateBountiesData>) => void;
  onDiscard: () => void;
  closeLabel: string;
  error: ReactNode;
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
      // Enter in a row's field submits nothing while it cannot save.
      onSubmit={(e) => {
        if (!canSave) e.preventDefault();
      }}
    >
      <input type="hidden" name="requestId" value={requestId} />
      {children}
      {status}
      {error}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !canSave}>
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

/** The three number fields, each a slider. */
type SliderField = "points" | "cooldownHours" | "effortFactorPct";

/**
 * One bounty's row: every setting. Its title names the bounty, and each
 * control's description points at it, so "Points" is heard as Trash's (a
 * slider's own name says it too: "Points for Trash"). The kiosk's six
 * columns: name and status; kind, photo proof and effort; then the points
 * (with their − and +) and the cooldown, each the whole width. The admin
 * page: at `lg` six columns, in rows of three and two, then the points and
 * the cooldown a row each (so the points' + is never read as the
 * cooldown's); at `sm` three, the points and the cooldown again the whole
 * width; on a phone every field the whole width.
 */
function BulkRow({
  bounty: b,
  draft: d,
  touched: t,
  changed,
  errors,
  kiosk,
  onChange,
  onClear,
}: {
  bounty: BulkEditorBounty;
  draft: BountyDraft;
  touched: Touched | undefined;
  changed: boolean;
  errors: Errors;
  kiosk: boolean;
  onChange: (patch: Touched) => void;
  /** Forget a touched field: the row shows the bounty's own value again. */
  onClear: (field: SliderField) => void;
}) {
  const id = (f: string) => `bulk-${b.id}-${f}`;
  const titleId = id("title");
  const describe = (c: { "aria-describedby"?: string }) =>
    [titleId, c["aria-describedby"]].filter(Boolean).join(" ");
  const control = kiosk ? "min-h-14 text-xl" : undefined;
  // Grid spans: [kiosk, admin page].
  const span = (k: string, hub: string) => (kiosk ? k : hub);
  const list = "col-span-2 sm:col-span-1 lg:col-span-2";
  const half = "col-span-2 sm:col-span-1 lg:col-span-3";
  const whole = "col-span-2 sm:col-span-3 lg:col-span-6";
  const size = kiosk ? "kiosk" : "default";

  /**
   * A number as a slider over `stops`, with the bounty's own value and the
   * row's value among them, so the thumb always stands where the text says.
   * Back at the bounty's own value the field is no longer touched, so a
   * later refresh shows what another admin saved meanwhile. A bounty with
   * no points yet has no value to show: its slider says "Not set" until
   * touched, and Clear (once touched) puts it back to that (§12 decision
   * 33). The points alone have − and + beside the slider, one point each
   * (decision 33).
   */
  const slider = (
    field: SliderField,
    label: string,
    stops: readonly number[],
    was: number | null,
    text: (n: number) => string,
  ) => {
    const value = sliderValue(d[field]);
    const set = (n: number) =>
      n === was ? onClear(field) : onChange({ [field]: String(n) });
    const step = (delta: 1 | -1) => {
      const next =
        value === null
          ? BASE_POINTS_MIN
          : Math.min(BASE_POINTS_MAX, Math.max(BASE_POINTS_MIN, value + delta));
      set(next);
      // At a limit the button turns itself off, and a disabled button
      // drops the focus to the page: hand it to the slider instead.
      if (next === (delta < 0 ? BASE_POINTS_MIN : BASE_POINTS_MAX)) {
        document.getElementById(id(field))?.focus();
      }
    };
    return (
      <Field id={id(field)} label={label} errors={errors[field]}>
        {(c) => (
          <div className="flex items-center gap-3">
            {field === "points" ? (
              <Button
                type="button"
                variant="secondary"
                size={size}
                aria-label={`One point less for ${b.name}`}
                disabled={value !== null && value <= BASE_POINTS_MIN}
                onClick={() => step(-1)}
              >
                −
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <Slider
                form={DETACHED}
                {...c}
                aria-label={`${label} for ${b.name}`}
                aria-describedby={describe(c)}
                kiosk={kiosk}
                stops={withStop(withStop(stops, was), value)}
                value={value}
                valueText={text}
                onValueChange={set}
              />
            </div>
            {field === "points" ? (
              <Button
                type="button"
                variant="secondary"
                size={size}
                aria-label={`One point more for ${b.name}`}
                disabled={value !== null && value >= BASE_POINTS_MAX}
                onClick={() => step(1)}
              >
                +
              </Button>
            ) : null}
            {was === null && t?.[field] !== undefined ? (
              <Button
                type="button"
                variant="secondary"
                size={size}
                aria-label={`Clear ${label} for ${b.name}`}
                onClick={() => onClear(field)}
              >
                Clear
              </Button>
            ) : null}
          </div>
        )}
      </Field>
    );
  };

  return (
    <li
      data-testid={`bulk-bounty-${b.name}`}
      data-changed={changed ? "true" : undefined}
      className={cx(
        "pixel-frame flex flex-col gap-3 p-3",
        // On the kiosk a focused field scrolls clear of the sticky Save
        // bar (with its status and any error), never resting under it.
        kiosk && "[&_input]:scroll-mb-60 [&_select]:scroll-mb-60",
        changed
          ? "bg-bm-amber/10 [--pf:var(--color-bm-amber)]"
          : "bg-bm-ink/40",
      )}
    >
      <div className="flex items-center gap-3">
        <BountyGlyph sprite={b.sprite} kind={d.kind} size="small" />
        <span id={titleId} className="font-semibold">
          {b.name}
        </span>
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
          // items-start: an error under one field never moves its
          // neighbours (every pair side by side has one-line labels).
          "grid items-start gap-3",
          kiosk ? "grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
        )}
      >
        <div className={span("col-span-4", "col-span-2")}>
          <Field id={id("name")} label="Name" errors={errors.name}>
            {(c) => (
              <Input
                form={DETACHED}
                {...c}
                aria-describedby={describe(c)}
                kiosk={kiosk}
                maxLength={CHORE_NAME_MAX}
                value={d.name}
                onChange={(e) => onChange({ name: e.currentTarget.value })}
              />
            )}
          </Field>
        </div>
        <div className={span("col-span-2", list)}>
          <Field id={id("status")} label="Status" errors={errors.archived}>
            {(c) => (
              <Select
                form={DETACHED}
                {...c}
                aria-describedby={describe(c)}
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
        </div>
        <div className={span("col-span-2", list)}>
          <Field id={id("kind")} label="Kind" errors={errors.kind}>
            {(c) => (
              <Select
                form={DETACHED}
                {...c}
                aria-describedby={describe(c)}
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
        </div>
        <div className={span("col-span-2", half)}>
          <Field id={id("proof")} label="Photo proof" errors={errors.proofMode}>
            {(c) => (
              <Select
                form={DETACHED}
                {...c}
                aria-describedby={describe(c)}
                className={control}
                value={d.proofMode}
                onChange={(e) =>
                  onChange({
                    proofMode: e.currentTarget
                      .value as BountyDraft["proofMode"],
                  })
                }
              >
                <option value="none">None</option>
                <option value="optional">Optional</option>
                <option value="required">Required</option>
              </Select>
            )}
          </Field>
        </div>
        <div className={span("col-span-2", half)}>
          {slider(
            "effortFactorPct",
            "Effort (%)",
            EFFORT_STOPS,
            b.effortFactorPct,
            effortText,
          )}
        </div>
        <div className={span("col-span-6", whole)}>
          {slider("points", "Points", POINT_STOPS, b.basePoints, pointsText)}
        </div>
        <div className={span("col-span-6", whole)}>
          {slider(
            "cooldownHours",
            "Cooldown (h)",
            COOLDOWN_STOPS,
            b.cooldownMinutes === null
              ? null
              : Number(hoursField(b.cooldownMinutes)),
            cooldownText,
          )}
        </div>
      </div>
    </li>
  );
}
