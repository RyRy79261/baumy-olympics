"use client";

import { useState } from "react";
import {
  AVATAR_HAIR_COLORS,
  AVATAR_HAIR_STYLES,
  AVATAR_SHIRT_COLORS,
  AVATAR_SKIN_TONES,
  type MemberAvatar,
} from "@baumy/types";
import {
  Button,
  Card,
  ChoiceGroup,
  FormMessage,
  HAIR_COLOURS,
  Housemate,
  SHIRT_COLOURS,
  SKIN_TONES,
  type ChoiceOption,
} from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { updateAvatarAction } from "./actions";

// Settings: choose my 16-bit character (ADR 0005 §5, issue #66): hair
// style, hair colour, skin tone and shirt colour, with the character drawn
// live as it changes. update_avatar saves it; the hub header, the kitchen
// screen's avatar bar and the reminder then draw it.

const title = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

function swatches(
  ids: readonly string[],
  colours: Readonly<Record<string, string>>,
): ChoiceOption[] {
  return ids.map((id) => ({
    value: id,
    label: (
      <>
        <span
          aria-hidden
          className="inline-block size-4 shadow-[0_0_0_2px_var(--color-bm-ink)]"
          style={{ background: colours[id] }}
        />
        {title(id)}
      </>
    ),
  }));
}

const HAIR_STYLE_OPTIONS: ChoiceOption[] = AVATAR_HAIR_STYLES.map((id) => ({
  value: id,
  label: title(id),
}));
const HAIR_COLOUR_OPTIONS = swatches(AVATAR_HAIR_COLORS, HAIR_COLOURS);
const SKIN_OPTIONS = swatches(AVATAR_SKIN_TONES, SKIN_TONES);
const SHIRT_OPTIONS = swatches(AVATAR_SHIRT_COLORS, SHIRT_COLOURS);

export function AvatarForm({
  memberId,
  initial,
}: {
  memberId: string;
  /** Their character now (their default one if they never chose). */
  initial: MemberAvatar;
}) {
  const { state, formAction, pending, requestId } =
    useActionForm(updateAvatarAction);
  const [avatar, setAvatar] = useState<MemberAvatar>(initial);
  const set =
    <K extends keyof MemberAvatar>(key: K) =>
    (value: string) =>
      setAvatar((a) => ({ ...a, [key]: value as MemberAvatar[K] }));

  return (
    <Card
      title="Your character"
      description="How you look on the kitchen screen and in the header."
    >
      <form
        action={formAction}
        className="flex flex-col gap-5"
        data-testid="avatar-form"
      >
        <input type="hidden" name="requestId" value={requestId} />
        <div
          data-testid="avatar-preview"
          data-hair-style={avatar.hairStyle}
          data-hair-color={avatar.hairColor}
          data-skin-tone={avatar.skinTone}
          data-shirt-color={avatar.shirtColor}
          className="pixel-frame flex justify-center self-start bg-bm-ink px-8 py-4"
        >
          <Housemate
            avatar={avatar}
            memberId={memberId}
            scale={8}
            label="Your character"
          />
        </div>
        <ChoiceGroup
          legend="Hair style"
          name="hairStyle"
          options={HAIR_STYLE_OPTIONS}
          value={avatar.hairStyle}
          onChange={set("hairStyle")}
          disabled={pending}
        />
        <ChoiceGroup
          legend="Hair colour"
          name="hairColor"
          options={HAIR_COLOUR_OPTIONS}
          value={avatar.hairColor}
          onChange={set("hairColor")}
          disabled={pending}
        />
        <ChoiceGroup
          legend="Skin"
          name="skinTone"
          options={SKIN_OPTIONS}
          value={avatar.skinTone}
          onChange={set("skinTone")}
          disabled={pending}
        />
        <ChoiceGroup
          legend="Shirt"
          name="shirtColor"
          options={SHIRT_OPTIONS}
          value={avatar.shirtColor}
          onChange={set("shirtColor")}
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
