"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Field,
  FormMessage,
  Input,
  type GalleryOption,
} from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { authClient } from "@/lib/auth-client";
import { joinAsFounderAction, redeemInviteAction } from "./actions";
import { ProfileFields } from "./profile-fields";

/** Redeem an invite code (redeem_invite). */
export function InviteForm({ gallery }: { gallery: readonly GalleryOption[] }) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(redeemInviteAction);
  return (
    <Card
      title="Join with an invite code"
      description="Ask a housemate who is an admin for a code."
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        <Field id="invite-code" label="Invite code" errors={errors.code}>
          {(control) => (
            <Input
              {...control}
              name="code"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={pending}
            />
          )}
        </Field>
        <ProfileFields
          prefix="invite"
          errors={errors}
          pending={pending}
          gallery={gallery}
        />
        {state && !state.ok && state.code !== "INVALID_INPUT" ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Joining..." : "Join the household"}
        </Button>
      </form>
    </Card>
  );
}

/** A founder on FOUNDER_EMAILS joins as an admin (join_as_founder). */
export function FounderForm({
  email,
  emailVerified,
  gallery,
}: {
  email: string;
  emailVerified: boolean;
  gallery: readonly GalleryOption[];
}) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(joinAsFounderAction);
  const [resent, setResent] = useState<"idle" | "sent" | "failed">("idle");

  if (!emailVerified) {
    return (
      <Card
        title="You're on the founders list"
        description="Confirm your email to set up the household as its admin."
      >
        <p className="mb-4 text-sm">
          Open the link we sent to {email}. Then come back to this page.
        </p>
        {resent === "sent" ? (
          <FormMessage tone="success">
            Sent. Check your inbox for the new link.
          </FormMessage>
        ) : resent === "failed" ? (
          <FormMessage tone="error">
            We couldn&rsquo;t send it. Try again in a minute.
          </FormMessage>
        ) : null}
        <Button
          variant="secondary"
          className="mt-4"
          onClick={async () => {
            const res = await authClient
              .sendVerificationEmail({ email, callbackURL: "/join" })
              .catch(() => null);
            setResent(res && !res.error ? "sent" : "failed");
          }}
        >
          Send the link again
        </Button>
      </Card>
    );
  }

  return (
    <Card
      title="You're on the founders list"
      description="Join as the household's admin. No invite code needed."
    >
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        <ProfileFields
          prefix="founder"
          errors={errors}
          pending={pending}
          gallery={gallery}
        />
        {state && !state.ok && state.code !== "INVALID_INPUT" ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Setting up..." : "Join as admin"}
        </Button>
      </form>
    </Card>
  );
}
