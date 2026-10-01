"use client";

import { useState } from "react";
import { AvatarGallery, MemberCharacter, type GalleryOption } from "@baumy/ui";

// /join: pick a character from the household's gallery (issue #111), or
// none (your initial in your colour). It is sent as `avatarImageId` with
// the join.

export function GalleryField({
  options,
  pending,
  colour,
}: {
  options: readonly GalleryOption[];
  pending: boolean;
  /** The colour picked above: the "None" tile shows it. */
  colour: string;
}) {
  const [value, setValue] = useState("");
  if (options.length === 0) return null;
  return (
    <AvatarGallery
      legend="Your character"
      name="avatarImageId"
      options={options}
      value={value}
      onChange={setValue}
      disabled={pending}
      none={{
        label: "None",
        picture: <MemberCharacter colour={colour} scale={3} />,
      }}
    />
  );
}
