"use client";

import { REMINDER_BODY_MAX, REMINDER_TITLE_MAX } from "@baumy/types";
import { Button, Card, Field, FormMessage, Input, Textarea } from "@baumy/ui";
import type { CreateReminderData } from "@/lib/actions/reminders";
import { useActionForm, type FormAction } from "../use-action-form";

// Post a reminder from the hub (ADR 0005 §4, issue #66): a title and a
// short body. The kitchen screen shows it full-screen until everyone has
// tapped "I've seen it", or someone dismisses it. Baumy can post one too
// (create_reminder, as a proposal).

export function PostReminderForm({
  action,
}: {
  action: FormAction<CreateReminderData>;
}) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(action);
  return (
    <Card
      title="Post a reminder"
      description="For something everyone must read, like a tradesperson coming. The kitchen screen shows it full-screen until everyone has seen it."
      data-testid="post-reminder"
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        <Field id="reminder-title" label="Title" errors={errors.title}>
          {(control) => (
            <Input
              {...control}
              name="title"
              maxLength={REMINDER_TITLE_MAX}
              placeholder="Handyman on Wednesday"
              required
              disabled={pending}
            />
          )}
        </Field>
        <Field
          id="reminder-body"
          label="Details"
          hint="Optional. A sentence or two."
          errors={errors.body}
        >
          {(control) => (
            <Textarea
              {...control}
              name="body"
              maxLength={REMINDER_BODY_MAX}
              rows={2}
              disabled={pending}
            />
          )}
        </Field>
        {state?.ok ? (
          <FormMessage tone="success">
            Posted &ldquo;{state.data.title}&rdquo;. It is on the kitchen screen
            now.
          </FormMessage>
        ) : state && state.code !== "INVALID_INPUT" ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Posting..." : "Post reminder"}
        </Button>
      </form>
    </Card>
  );
}
