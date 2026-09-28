"use client";

import { useEffect, useState } from "react";
import { AVATAR_SPRITES } from "@baumy/types";
import {
  Button,
  Card,
  Dialog,
  Field,
  FormMessage,
  Input,
  Select,
  Sprite,
} from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { toast } from "@/lib/ui/toast";
import {
  manageMembersAction,
  mintInviteAction,
  revokeInviteAction,
} from "./actions";

/** mint_invite: role, uses and expiry; shows the new code once minted. */
export function MintInviteForm() {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(mintInviteAction);
  return (
    <Card
      title="Invite someone"
      description="Make a code and give it to them. They sign up, then enter it."
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="invite-role" label="Role" errors={errors.role}>
            {(control) => (
              <Select {...control} name="role" defaultValue="member">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
            )}
          </Field>
          <Field id="invite-uses" label="Uses" errors={errors.maxUses}>
            {(control) => (
              <Input
                {...control}
                name="maxUses"
                type="number"
                min={1}
                max={20}
                defaultValue={1}
              />
            )}
          </Field>
          <Field
            id="invite-days"
            label="Expires in (days)"
            errors={errors.expiresInDays}
          >
            {(control) => (
              <Input
                {...control}
                name="expiresInDays"
                type="number"
                min={1}
                max={30}
                defaultValue={7}
              />
            )}
          </Field>
        </div>
        {state?.ok ? (
          <FormMessage tone="success">
            New code:{" "}
            <code data-testid="minted-code" className="font-mono">
              {state.data.code}
            </code>
          </FormMessage>
        ) : state && state.code !== "INVALID_INPUT" ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create invite code"}
        </Button>
      </form>
    </Card>
  );
}

/** revoke_invite, one tap: the outcome is a toast. */
export function RevokeInviteButton({ code }: { code: string }) {
  const { state, formAction, pending, requestId } =
    useActionForm(revokeInviteAction);
  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(`Cancelled ${state.data.code}.`);
    else toast.error(state.message);
  }, [state]);
  return (
    <form action={formAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="code" value={code} />
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        aria-label={`Cancel code ${code}`}
      >
        Cancel code
      </Button>
    </form>
  );
}

export interface MemberRowProps {
  id: string;
  displayName: string;
  avatarSprite: string;
  color: string;
  role: "admin" | "member";
  active: boolean;
  isMe: boolean;
  telegramUserId: number | null;
}

/** One member: role, active or not, and how they look (manage_members). */
export function MemberControls(props: MemberRowProps) {
  const role = useActionForm(manageMembersAction);
  const status = useActionForm(manageMembersAction);
  const edit = useActionForm(manageMembersAction);
  const telegram = useActionForm(manageMembersAction);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (status.state && !status.state.ok) toast.error(status.state.message);
    if (status.state?.ok) {
      setConfirming(false);
      toast.success(
        status.state.data.active
          ? `${status.state.data.displayName} is active again.`
          : `${status.state.data.displayName} is deactivated.`,
      );
    }
  }, [status.state]);

  const statusForm = (
    <form action={status.formAction}>
      <input type="hidden" name="requestId" value={status.requestId} />
      <input
        type="hidden"
        name="op"
        value={props.active ? "deactivate" : "reactivate"}
      />
      <input type="hidden" name="memberId" value={props.id} />
      <Button
        type="submit"
        variant={props.active ? "danger" : "secondary"}
        disabled={status.pending}
      >
        {props.active ? "Deactivate" : "Reactivate"}
      </Button>
    </form>
  );

  return (
    <li
      className="flex flex-col gap-4 border-b border-bm-line py-4 last:border-b-0"
      data-testid={`member-${props.displayName}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Sprite name={props.avatarSprite} color={props.color} />
        <span className="font-semibold">{props.displayName}</span>
        <span className="text-sm text-bm-muted">
          {props.role === "admin" ? "Admin" : "Member"}
          {props.active ? "" : " · deactivated"}
          {props.isMe ? " · you" : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <form action={role.formAction} className="flex items-end gap-2">
          <input type="hidden" name="requestId" value={role.requestId} />
          <input type="hidden" name="op" value="set_role" />
          <input type="hidden" name="memberId" value={props.id} />
          <Field id={`role-${props.id}`} label="Role">
            {(control) => (
              <Select {...control} name="role" defaultValue={props.role}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </Select>
            )}
          </Field>
          <Button type="submit" variant="secondary" disabled={role.pending}>
            Save role
          </Button>
        </form>

        {props.active ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Deactivate
          </Button>
        ) : (
          statusForm
        )}
      </div>
      {role.state && !role.state.ok ? (
        <FormMessage tone="error">{role.state.message}</FormMessage>
      ) : null}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Deactivate ${props.displayName}?`}
      >
        <p className="mb-4 text-sm">
          They lose access to the hub straight away. Their history stays, and
          you can reactivate them later.
        </p>
        <div className="flex gap-2">
          {statusForm}
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Keep them
          </Button>
        </div>
      </Dialog>

      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline">
          Edit name, colour and avatar
        </summary>
        <form
          action={edit.formAction}
          className="mt-3 grid gap-4 sm:grid-cols-4"
        >
          <input type="hidden" name="requestId" value={edit.requestId} />
          <input type="hidden" name="op" value="edit" />
          <input type="hidden" name="memberId" value={props.id} />
          <Field
            id={`name-${props.id}`}
            label="Name"
            errors={edit.errors.displayName}
          >
            {(control) => (
              <Input
                {...control}
                name="displayName"
                defaultValue={props.displayName}
                maxLength={40}
              />
            )}
          </Field>
          <Field
            id={`color-${props.id}`}
            label="Colour"
            errors={edit.errors.color}
          >
            {(control) => (
              <Input
                {...control}
                name="color"
                type="color"
                defaultValue={props.color}
              />
            )}
          </Field>
          <Field
            id={`avatar-${props.id}`}
            label="Avatar"
            errors={edit.errors.avatarSprite}
          >
            {(control) => (
              <Select
                {...control}
                name="avatarSprite"
                defaultValue={props.avatarSprite}
              >
                {AVATAR_SPRITES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={edit.pending}>
              Save
            </Button>
          </div>
          {edit.state?.ok ? (
            <FormMessage tone="success">Saved.</FormMessage>
          ) : edit.state && edit.state.code !== "INVALID_INPUT" ? (
            <FormMessage tone="error">{edit.state.message}</FormMessage>
          ) : null}
        </form>
      </details>

      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline">
          Telegram {props.telegramUserId === null ? "(not linked)" : "(linked)"}
        </summary>
        <form
          action={telegram.formAction}
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="requestId" value={telegram.requestId} />
          <input type="hidden" name="op" value="set_telegram" />
          <input type="hidden" name="memberId" value={props.id} />
          <Field
            id={`telegram-${props.id}`}
            label="Telegram user id"
            hint="Leave it empty to unlink. Members can also link themselves with /link in Telegram."
            errors={telegram.errors.telegramUserId}
          >
            {(control) => (
              <Input
                {...control}
                name="telegramUserId"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={props.telegramUserId ?? ""}
              />
            )}
          </Field>
          <Button type="submit" disabled={telegram.pending}>
            Save Telegram id
          </Button>
          {telegram.state?.ok ? (
            <FormMessage tone="success">
              {telegram.state.data.telegramUserId === null
                ? "Telegram unlinked."
                : "Telegram id saved."}
            </FormMessage>
          ) : telegram.state && telegram.state.code !== "INVALID_INPUT" ? (
            <FormMessage tone="error">{telegram.state.message}</FormMessage>
          ) : null}
        </form>
      </details>
    </li>
  );
}
