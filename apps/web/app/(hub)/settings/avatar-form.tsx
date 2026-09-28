"use client";

import { useState } from "react";
import type { MemberAvatar } from "@baumy/types";
import { Button, Card, CharacterPicker, FormMessage } from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { updateAvatarAction } from "./actions";

// Settings: choose my 16-bit character (ADR 0005 §5, issue #66): hair
// style, hair colour, skin tone and shirt colour, with the character drawn
// live as it changes, each hair style shown on the character and each
// colour as a swatch (issue #106). update_avatar saves it; the hub header,
// the kitchen screen's avatar bar and the reminder then draw it.

export function AvatarForm({
  initial,
}: {
  /** Their character now (their default one if they never chose). */
  initial: MemberAvatar;
}) {
  const { state, formAction, pending, requestId } =
    useActionForm(updateAvatarAction);
  const [avatar, setAvatar] = useState<MemberAvatar>(initial);

  return (
    <Card
      title="Your character"
      description="How you look on the kitchen screen and in the header."
    >
      <form
        id="character"
        action={formAction}
        className="flex flex-col gap-5"
        data-testid="avatar-form"
      >
        <input type="hidden" name="requestId" value={requestId} />
        <CharacterPicker
          avatar={avatar}
          onChange={setAvatar}
          disabled={pending}
        />
        {state?.ok ? (
          <FormMessage tone="success">Character saved.</FormMessage>
        ) : state ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving..." : "Save character"}
        </Button>
      </form>
    </Card>
  );
}
