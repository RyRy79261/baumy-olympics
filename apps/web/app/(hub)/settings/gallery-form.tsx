"use client";

import { useState } from "react";
import {
  AvatarGallery,
  Button,
  Card,
  FormMessage,
  MemberCharacter,
  type GalleryOption,
} from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { chooseAvatarAction } from "./actions";

// Settings, "Your character" once the household has a gallery (issue #111):
// tap a character, then save; choose_avatar puts it on you, and the header,
// the kitchen screen and the reminder show it. The first tile is your
// initial in your colour, which is what you show until you pick one.

export function GalleryForm({
  displayName,
  colour,
  options,
  picked,
  archivedName,
}: {
  /** Their name and colour: the "none" tile is their initial tile. */
  displayName: string;
  colour: string;
  options: readonly GalleryOption[];
  /** The gallery character they wear now, or "" for none. */
  picked: string;
  /** The name of an archived character they still wear, if so. */
  archivedName?: string;
}) {
  const { state, formAction, pending, requestId } =
    useActionForm(chooseAvatarAction);
  const [value, setValue] = useState(picked);
  return (
    <Card
      title="Your character"
      description="How you look on the kitchen screen and in the header. Pick one from the household's gallery."
    >
      <form
        id="character"
        action={formAction}
        className="flex flex-col gap-5"
        data-testid="gallery-form"
      >
        <input type="hidden" name="requestId" value={requestId} />
        {archivedName ? (
          <p className="text-sm text-bm-muted">
            You wear {archivedName}, which has been taken out of the gallery.
            You keep it until you pick another.
          </p>
        ) : null}
        <AvatarGallery
          legend="Gallery"
          name="avatarId"
          options={options}
          value={value}
          onChange={setValue}
          disabled={pending}
          none={{
            label: "None",
            picture: (
              <MemberCharacter name={displayName} colour={colour} scale={3} />
            ),
          }}
        />
        {state?.ok ? (
          <FormMessage tone="success">You wear it now.</FormMessage>
        ) : state ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving..." : "Wear this character"}
        </Button>
      </form>
    </Card>
  );
}
