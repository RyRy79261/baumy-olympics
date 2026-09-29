"use client";

import { useState } from "react";
import { MEMBER_COLORS, type MemberAvatar } from "@baumy/types";
import {
  CharacterPicker,
  Field,
  Input,
  SwatchPicker,
  memberColourOptions,
} from "@baumy/ui";

const COLOUR_OPTIONS = memberColourOptions();

/**
 * The name, colour and character a new member picks, shared by both forms
 * (issue #106): the colour as swatches, the character as the character
 * picker Settings has, starting on `initialAvatar` (its shirt one nobody
 * wears yet), which the join actions store as the member's character.
 */
export function ProfileFields({
  prefix,
  errors,
  pending,
  initialAvatar,
}: {
  prefix: string;
  errors: Record<string, string[]>;
  pending: boolean;
  initialAvatar: MemberAvatar;
}) {
  const [color, setColor] = useState<string>(MEMBER_COLORS[0]);
  const [avatar, setAvatar] = useState<MemberAvatar>(initialAvatar);
  const colorError = errors.color?.length ? `${prefix}-color-error` : undefined;
  const avatarErrors = [
    ...(errors.hairStyle ?? []),
    ...(errors.hairColor ?? []),
    ...(errors.skinTone ?? []),
    ...(errors.shirtColor ?? []),
  ];
  return (
    <>
      <Field
        id={`${prefix}-name`}
        label="Your name"
        hint="What housemates see."
        errors={errors.displayName}
      >
        {(control) => (
          <Input
            {...control}
            name="displayName"
            autoComplete="nickname"
            required
            maxLength={40}
            disabled={pending}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1">
        <SwatchPicker
          legend="Colour"
          name="color"
          value={color}
          onChange={setColor}
          disabled={pending}
          describedBy={colorError}
          options={COLOUR_OPTIONS}
          testId={`${prefix}-color`}
        />
        {colorError ? (
          <p id={colorError} className="text-base text-bm-red">
            {errors.color!.join(" ")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1" data-testid={`${prefix}-character`}>
        <p className="font-label text-sm font-bold tracking-wide text-bm-text uppercase">
          Your character
        </p>
        <CharacterPicker
          avatar={avatar}
          onChange={setAvatar}
          disabled={pending}
        />
        {avatarErrors.length > 0 ? (
          <p className="text-base text-bm-red">{avatarErrors.join(" ")}</p>
        ) : null}
      </div>
    </>
  );
}
