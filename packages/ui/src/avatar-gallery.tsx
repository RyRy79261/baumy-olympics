import type { AvatarSprites } from "@baumy/types";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { MemberCharacter } from "./member-character";

// The avatar gallery as a picker (issue #111): a grid of the household's
// pixel characters, one radio each, the picked one framed in violet with a
// "Picked" tag, so the choice is clear without hover. The first tile can be
// "no gallery character" (their drawn one), whose value is "".

export interface GalleryOption {
  id: string;
  name: string;
  sprites: AvatarSprites;
}

const tile =
  "pixel-frame pixel-frame-within relative flex min-h-28 min-w-24 cursor-pointer flex-col items-center justify-end gap-2 px-2 pt-3 pb-2 font-label text-xs font-bold uppercase";

export function AvatarGallery({
  legend,
  name,
  options,
  value,
  onChange,
  none,
  disabled,
}: {
  legend: ReactNode;
  /** The form field: the picked id, or "" for none. */
  name: string;
  options: readonly GalleryOption[];
  value: string;
  onChange: (value: string) => void;
  /** The "none" tile's picture (the drawn character); omitted, no tile. */
  none?: { label: string; picture: ReactNode };
  disabled?: boolean;
}) {
  const tiles = [
    ...(none ? [{ id: "", name: none.label, picture: none.picture }] : []),
    ...options.map((o) => ({
      id: o.id,
      name: o.name,
      picture: <MemberCharacter sprites={o.sprites} scale={4} />,
    })),
  ];
  return (
    <fieldset className="flex flex-col gap-2" data-testid="avatar-gallery">
      <legend className="mb-1 font-label text-sm font-bold tracking-wide text-bm-text uppercase">
        {legend}
      </legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
        {tiles.map((t) => {
          const picked = t.id === value;
          return (
            <label
              key={t.id || "none"}
              data-avatar={t.id || "none"}
              data-picked={picked}
              className={cx(
                tile,
                picked
                  ? "bg-bm-violet/15 text-bm-text [--pf:var(--color-bm-violet)]"
                  : "bg-bm-ink text-bm-muted",
              )}
            >
              <input
                type="radio"
                name={name}
                value={t.id}
                checked={picked}
                onChange={() => onChange(t.id)}
                disabled={disabled}
                className="sr-only"
              />
              {picked ? (
                <span className="absolute top-1 right-1 bg-bm-violet px-1 text-[10px] text-bm-ink">
                  Picked
                </span>
              ) : null}
              {t.picture}
              <span
                data-name
                className="max-w-full text-center leading-tight break-words"
              >
                {t.name}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
