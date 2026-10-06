"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  COOLDOWN_HOURS_MAX,
  EFFORT_FACTOR_MAX,
  EFFORT_FACTOR_MIN,
} from "@baumy/types";
import {
  BountyGlyph,
  Button,
  ChoreIconPicker,
  choreIconValue,
  Card,
  Dialog,
  Field,
  FormMessage,
  Input,
  Select,
} from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { useReportPending } from "@/components/use-report-pending";
import type { ChoreView } from "@/lib/actions/list-chores";
import { toast } from "@/lib/ui/toast";
import { manageChoreAction } from "./actions";

// The admin chores page's forms, all `manage_chore`: create, edit (a dialog
// per chore), archive and restore (one tap, a toast). The Bounties page
// reuses create (NewBountyButton) and edit (EditChoreDialog, with its own
// points section) for admins (issue #109).

export interface ChoreFormValues {
  name: string;
  kind: ChoreView["kind"];
  basePoints: number;
  cooldownHours: number;
  proofMode: ChoreView["proofMode"];
  effortFactorPct: number;
  /** The chore's `chores.sprite`; undefined for a new chore. */
  sprite?: string;
}

/** The chore's icon, picked from the glyphs themselves (issue #106). */
function ChoreIconField({ sprite }: { sprite?: string }) {
  const [icon, setIcon] = useState(() => choreIconValue(sprite));
  return (
    <div className="sm:col-span-2">
      <ChoreIconPicker sprite={sprite} value={icon} onChange={setIcon} />
    </div>
  );
}

const NEW_CHORE: ChoreFormValues = {
  name: "",
  kind: "maintenance",
  basePoints: 20,
  cooldownHours: 24,
  proofMode: "none",
  effortFactorPct: 100,
};

/**
 * The fields both forms share, with inline errors. Without `weight` the
 * points and cooldown are left out, and so kept as they are.
 */
function ChoreFields({
  prefix,
  values,
  errors,
  weight = true,
}: {
  prefix: string;
  values: ChoreFormValues;
  errors: Record<string, string[]>;
  weight?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`${prefix}-name`} label="Name" errors={errors.name}>
        {(control) => (
          <Input {...control} name="name" required defaultValue={values.name} />
        )}
      </Field>
      <ChoreIconField sprite={values.sprite} />
      <Field
        id={`${prefix}-kind`}
        label="Kind"
        hint="Buy or refill, or clean or fix."
        errors={errors.kind}
      >
        {(control) => (
          <Select {...control} name="kind" defaultValue={values.kind}>
            <option value="maintenance">Maintenance</option>
            <option value="consumable">Consumable</option>
          </Select>
        )}
      </Field>
      {weight ? (
        <>
          <Field
            id={`${prefix}-base`}
            label="Base points"
            hint={`${BASE_POINTS_MIN} to ${BASE_POINTS_MAX}, before streaks and breaks.`}
            errors={errors.basePoints}
          >
            {(control) => (
              <Input
                {...control}
                name="basePoints"
                type="number"
                inputMode="numeric"
                min={BASE_POINTS_MIN}
                max={BASE_POINTS_MAX}
                required
                defaultValue={values.basePoints}
              />
            )}
          </Field>
          <Field
            id={`${prefix}-cooldown`}
            label="Cooldown (hours)"
            hint="How long before anyone may log it again. 84 is 3.5 days."
            errors={errors.cooldownHours}
          >
            {(control) => (
              <Input
                {...control}
                name="cooldownHours"
                type="number"
                inputMode="decimal"
                min={0}
                max={COOLDOWN_HOURS_MAX}
                step="0.25"
                required
                defaultValue={values.cooldownHours}
              />
            )}
          </Field>
        </>
      ) : null}
      <Field
        id={`${prefix}-effort`}
        label="Effort factor (%)"
        hint="100 is normal; weight suggestions scale with it."
        errors={errors.effortFactorPct}
      >
        {(control) => (
          <Input
            {...control}
            name="effortFactorPct"
            type="number"
            inputMode="numeric"
            min={EFFORT_FACTOR_MIN}
            max={EFFORT_FACTOR_MAX}
            required
            defaultValue={values.effortFactorPct}
          />
        )}
      </Field>
      <Field
        id={`${prefix}-proof`}
        label="Photo proof"
        errors={errors.proofMode}
      >
        {(control) => (
          <Select {...control} name="proofMode" defaultValue={values.proofMode}>
            <option value="none">None</option>
            <option value="optional">Optional</option>
            <option value="required">Required</option>
          </Select>
        )}
      </Field>
    </div>
  );
}

/** A failure that is not about one field, shown above the button. */
function FormError({
  state,
}: {
  state: ReturnType<typeof useActionForm>["state"];
}) {
  if (!state || state.ok || state.code === "INVALID_INPUT") return null;
  return <FormMessage tone="error">{state.message}</FormMessage>;
}

/** The create form, fresh again after each chore is added. */
function CreateChoreBody({
  prefix,
  label,
  onAdded,
  onPending,
}: {
  prefix: string;
  label: string;
  onAdded?: () => void;
  /** Told while the add is on its way (its dialog stays open, #174). */
  onPending?: (pending: boolean) => void;
}) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(manageChoreAction);
  useReportPending(pending, onPending);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state?.ok) {
      toast.success(`Added ${state.data.name}.`);
      setRound((n) => n + 1);
      onAdded?.();
    }
    // `onAdded` is a new function on every render.
  }, [state]);
  return (
    <form key={round} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="op" value="create" />
      <ChoreFields prefix={prefix} values={NEW_CHORE} errors={errors} />
      <FormError state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adding..." : label}
      </Button>
    </form>
  );
}

export function CreateChoreForm() {
  return (
    <Card title="Add a chore">
      <CreateChoreBody prefix="new" label="Add chore" />
    </Card>
  );
}

/** The Bounties page's "New bounty": the same create form, in a dialog. */
export function NewBountyButton() {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New bounty</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        busy={adding}
        title="New bounty"
      >
        {open ? (
          <CreateChoreBody
            prefix="new-bounty"
            label="Add bounty"
            onAdded={() => setOpen(false)}
            onPending={setAdding}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/**
 * The edit dialog. Given `points` (the Bounties page), it shows that section
 * in place of the points and cooldown fields, which it then leaves as they
 * are, and links to /admin/chores for archiving.
 */
export function EditChoreDialog({
  chore,
  onClose,
  points,
}: {
  chore: ChoreView;
  onClose: () => void;
  points?: ReactNode;
}) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(manageChoreAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success(
        state.data.weightChanged
          ? `Saved ${state.data.name}. The new points apply from now on.`
          : `Saved ${state.data.name}.`,
      );
      onClose();
    }
    // `onClose` is a new function on every render.
  }, [state]);
  return (
    <Dialog open onClose={onClose} busy={pending} title={`Edit ${chore.name}`}>
      {points}
      {/* No browser validation: a cleared field gets the action's inline
          error (both points and cooldown blank is "Required", issue #115). */}
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="op" value="update" />
        <input type="hidden" name="choreId" value={chore.id} />
        {points !== undefined ? (
          <input type="hidden" name="weight" value="keep" />
        ) : null}
        <ChoreFields
          prefix={`edit-${chore.id}`}
          values={{
            name: chore.name,
            kind: chore.kind,
            basePoints: chore.basePoints ?? NEW_CHORE.basePoints,
            cooldownHours:
              chore.cooldownMinutes !== null
                ? chore.cooldownMinutes / 60
                : NEW_CHORE.cooldownHours,
            proofMode: chore.proofMode,
            effortFactorPct: chore.effortFactorPct,
            sprite: chore.sprite,
          }}
          errors={errors}
          weight={points === undefined}
        />
        {points === undefined ? (
          <p className="text-sm text-bm-muted">
            New points or a new cooldown apply from now on; what was already
            scored keeps its points.
          </p>
        ) : null}
        <FormError state={state} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
      {points !== undefined ? (
        <p className="mt-4 text-sm text-bm-muted">
          <Link
            href="/admin/chores"
            className="underline underline-offset-4 hover:text-bm-text"
          >
            More options
          </Link>{" "}
          (archive, restore) on Edit chores.
        </p>
      ) : null}
    </Dialog>
  );
}

/** One chore on the admin page: what it is, Edit, Archive or Restore. */
export function ChoreAdminRow({ chore }: { chore: ChoreView }) {
  const [editing, setEditing] = useState(false);
  const archive = useActionForm(manageChoreAction);
  useEffect(() => {
    if (!archive.state) return;
    if (!archive.state.ok) toast.error(archive.state.message);
    else
      toast.success(
        archive.state.data.archived
          ? `Archived ${archive.state.data.name}.`
          : `Restored ${archive.state.data.name}.`,
      );
  }, [archive.state]);

  return (
    <li
      className="flex flex-wrap items-center gap-3 border-b border-bm-line py-3 last:border-b-0"
      data-testid={`admin-chore-${chore.name}`}
    >
      <BountyGlyph sprite={chore.sprite} kind={chore.kind} size="small" />
      <span className="font-semibold">{chore.name}</span>
      <span className="text-sm text-bm-muted">
        {chore.basePoints !== null ? `${chore.basePoints} pts` : "no points"}
        {chore.cooldownMinutes !== null
          ? ` · cooldown ${chore.cooldownMinutes / 60}h`
          : ""}
        {` · ${chore.kind} · proof ${chore.proofMode} · effort ${chore.effortFactorPct}%`}
        {chore.archived ? " · archived" : ""}
      </span>
      <span className="ml-auto flex gap-2">
        {chore.archived ? null : (
          <Button
            variant="secondary"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${chore.name}`}
          >
            Edit
          </Button>
        )}
        <form action={archive.formAction}>
          <input type="hidden" name="requestId" value={archive.requestId} />
          <input
            type="hidden"
            name="op"
            value={chore.archived ? "restore" : "archive"}
          />
          <input type="hidden" name="choreId" value={chore.id} />
          <Button
            type="submit"
            variant="secondary"
            disabled={archive.pending}
            aria-label={`${chore.archived ? "Restore" : "Archive"} ${chore.name}`}
          >
            {chore.archived ? "Restore" : "Archive"}
          </Button>
        </form>
      </span>
      {editing ? (
        <EditChoreDialog chore={chore} onClose={() => setEditing(false)} />
      ) : null}
    </li>
  );
}
