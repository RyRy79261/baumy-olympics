"use client";

import { useState } from "react";
import { AvatarGallery, Housemate, type GalleryOption } from "@baumy/ui";

// /join: pick a character from the household's gallery (issue #111), or
// keep the drawn one. It is sent as `avatarImageId` with the join.

export function GalleryField({
  options,
  pending,
}: {
  options: readonly GalleryOption[];
  pending: boolean;
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
      none={{ label: "Drawn", picture: <Housemate scale={3} /> }}
    />
  );
}
