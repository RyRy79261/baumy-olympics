"use client";

import { useState } from "react";
import { MEMBER_COLORS } from "@baumy/types";
import {
  Field,
  Input,
  SwatchPicker,
  memberColourOptions,
  type GalleryOption,
} from "@baumy/ui";
import { GalleryField } from "./gallery-field";

const COLOUR_OPTIONS = memberColourOptions();

/**
 * The name, colour and character a new member picks, shared by both forms
 * (issue #106): the colour as swatches, and a character from the household's
 * gallery when it has one (issue #111). Without one they show as their
 * initial in their colour (issue #116).
 */
export function ProfileFields({
  prefix,
  errors,
  pending,
  gallery = [],
}: {
  prefix: string;
  errors: Record<string, string[]>;
  pending: boolean;
  /** The household's avatar gallery (issue #111); empty, no picker. */
  gallery?: readonly GalleryOption[];
}) {
  const [color, setColor] = useState<string>(MEMBER_COLORS[0]);
  const [name, setName] = useState("");
  const colorError = errors.color?.length ? `${prefix}-color-error` : undefined;
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
            onChange={(e) => setName(e.target.value)}
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
      <GalleryField
        options={gallery}
        pending={pending}
        colour={color}
        name={name}
      />
    </>
  );
}
