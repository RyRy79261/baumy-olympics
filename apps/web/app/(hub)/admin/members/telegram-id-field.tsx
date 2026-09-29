"use client";

import { useState } from "react";
import { TELEGRAM_ID_MESSAGE, TelegramUserId } from "@baumy/types";
import { Button, Dialog, Field, Input } from "@baumy/ui";

// The admin members page's Telegram id field (owner request, issue #106):
// checked as they are typed with the same TelegramUserId schema the server
// (manage_members) parses it with, and a "How do I find this?" popup.

export const DIGITS_ONLY = TELEGRAM_ID_MESSAGE;

/** The inline error for what is typed so far, or undefined. Empty unlinks. */
export function telegramIdError(value: string): string | undefined {
  if (value.trim() === "") return undefined;
  return TelegramUserId.safeParse(value).success ? undefined : DIGITS_ONLY;
}

export function TelegramIdField({
  memberId,
  displayName,
  initial,
  serverErrors,
  onValidity,
}: {
  memberId: string;
  displayName: string;
  initial: string;
  serverErrors?: string[];
  /** Told whether what is typed may be saved. */
  onValidity?: (ok: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const [helping, setHelping] = useState(false);
  const typed = telegramIdError(value);
  const errors = typed ? [typed] : serverErrors;
  return (
    <div className="flex flex-col gap-2">
      <Field
        id={`telegram-${memberId}`}
        label="Telegram user id"
        hint="Leave it empty to unlink. Members can also link themselves with /link in Telegram."
        errors={errors}
      >
        {(control) => (
          <Input
            {...control}
            name="telegramUserId"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              onValidity?.(!telegramIdError(e.target.value));
            }}
          />
        )}
      </Field>
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        onClick={() => setHelping(true)}
        aria-haspopup="dialog"
      >
        How do I find this?
      </Button>
      <Dialog
        open={helping}
        onClose={() => setHelping(false)}
        title="Finding a Telegram user id"
      >
        <div
          className="flex flex-col gap-3 text-base"
          data-testid="telegram-help"
        >
          <p>
            <strong>Easiest:</strong> let {displayName} link themselves. In
            their Settings they tap &ldquo;Create a link code&rdquo; and send it
            to @baumy_bot in Telegram. Nothing to type here.
          </p>
          <p>
            <strong>Otherwise:</strong> {displayName} opens Telegram and
            messages @userinfobot (or @getidsbot). It replies with their numeric
            id.
          </p>
          <p>Enter only the digits, for example 123456789.</p>
          <Button
            type="button"
            className="self-start"
            onClick={() => setHelping(false)}
          >
            Got it
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
