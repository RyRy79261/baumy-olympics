import {
  AVATAR_HAIR_COLORS,
  AVATAR_HAIR_STYLES,
  AVATAR_SHIRT_COLORS,
  AVATAR_SKIN_TONES,
  CHORE_ICONS,
  MEMBER_COLORS,
  memberColorName,
  type ChoreIcon,
  type MemberAvatar,
} from "@baumy/types";
import type { ReactNode } from "react";
import { choreGlyph } from "./chores";
import { cx } from "./cx";
import {
  HAIR_COLOURS,
  Housemate,
  SHIRT_COLOURS,
  SKIN_TONES,
} from "./housemate";
import { Glyph } from "./pixel/glyph";
import type { GlyphName } from "./pixel/glyphs";

// Pickers that show the thing itself, not its name (issue #106): a colour is
// a swatch of that colour, a hair style is the character wearing it. Each is
// a fieldset of native radios, visually hidden inside pixel-framed tiles, so
// Tab reaches the group, the arrow keys move through it and a form posts
// the value; the option's name is the radio's accessible name. The chosen
// tile has the thick violet frame and the check glyph (ADR 0005: violet is
// "chosen" everywhere, as in ChoiceGroup).

export interface TileOption {
  value: string;
  /** The accessible name (and the caption, when shown). Never a hex. */
  label: string;
  /** What the tile shows: a swatch, a sprite. Decorative. */
  tile: ReactNode;
}

/**
 * A radio group of picture tiles, at least 44px (56px on the kiosk).
 * Controlled: `value` and `onChange`. `captions` prints each label small
 * under its tile; the picture stays the affordance.
 */
export function TilePicker({
  legend,
  name,
  options,
  value,
  onChange,
  kiosk = false,
  captions = false,
  disabled,
  describedBy,
  testId,
}: {
  legend: ReactNode;
  name: string;
  options: readonly TileOption[];
  value: string;
  onChange: (value: string) => void;
  kiosk?: boolean;
  captions?: boolean;
  disabled?: boolean;
  /** Ids of a hint or an error under the group. */
  describedBy?: string;
  testId?: string;
}) {
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-2"
      aria-describedby={describedBy}
      data-testid={testId}
    >
      <legend className="mb-1 font-label text-sm font-bold tracking-wide text-bm-text uppercase">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const chosen = o.value === value;
          return (
            <label
              key={o.value}
              data-value={o.value}
              data-chosen={chosen || undefined}
              className={cx(
                "pixel-frame pixel-frame-within relative inline-flex cursor-pointer flex-col items-center justify-center gap-1 p-2",
                chosen
                  ? "pixel-frame-4 bg-bm-violet/15 [--pf:var(--color-bm-violet)]"
                  : "bg-bm-raised",
                kiosk ? "min-h-14 min-w-14" : "min-h-11 min-w-11",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={chosen}
                onChange={() => onChange(o.value)}
                disabled={disabled}
                aria-label={o.label}
                className="sr-only"
              />
              <span aria-hidden className="flex items-center justify-center">
                {o.tile}
              </span>
              {captions ? (
                <span
                  aria-hidden
                  className={cx(
                    "font-label text-[10px] leading-none font-bold uppercase",
                    chosen ? "text-bm-text" : "text-bm-muted",
                  )}
                >
                  {o.label}
                </span>
              ) : null}
              {chosen ? (
                <span
                  aria-hidden
                  data-check
                  className="absolute top-0 right-0 grid size-4 place-items-center bg-bm-violet"
                >
                  <Glyph name="check" size={12} color="var(--color-bm-ink)" />
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A square of `colour` in an ink frame: a swatch tile's picture. */
export function Swatch({
  colour,
  kiosk = false,
}: {
  colour: string;
  kiosk?: boolean;
}) {
  return (
    <span
      data-swatch={colour}
      className={cx(
        "pixel-frame block [--pf:var(--color-bm-ink)]",
        kiosk ? "size-10" : "size-7",
      )}
      style={{ backgroundColor: colour }}
    />
  );
}

export interface SwatchOption {
  value: string;
  /** The colour to show, `#rrggbb` or any CSS colour. */
  colour: string;
  /** Its name, e.g. "Orange": the accessible name, never the hex. */
  label: string;
}

/** A radio group of colour swatches (TilePicker with Swatch tiles). */
export function SwatchPicker({
  options,
  kiosk = false,
  ...props
}: Omit<Parameters<typeof TilePicker>[0], "options"> & {
  options: readonly SwatchOption[];
}) {
  return (
    <TilePicker
      {...props}
      kiosk={kiosk}
      options={options.map((o) => ({
        value: o.value,
        label: o.label,
        tile: <Swatch colour={o.colour} kiosk={kiosk} />,
      }))}
    />
  );
}

/**
 * The member colours as swatches, named ("Orange"), never shown as hex.
 * A `current` colour the list does not offer (any `#rrggbb` is valid) comes
 * first as "Custom colour", so editing a member never silently changes it.
 */
export function memberColourOptions(current?: string): SwatchOption[] {
  const offered: SwatchOption[] = MEMBER_COLORS.map((c) => ({
    value: c,
    colour: c,
    label: memberColorName(c),
  }));
  const own = current?.toLowerCase();
  if (!own || offered.some((o) => o.value === own)) return offered;
  return [{ value: own, colour: own, label: memberColorName(own) }, ...offered];
}

/** What each chore icon is called: its accessible name and caption. */
export const CHORE_ICON_LABELS: Readonly<Record<ChoreIcon, string>> = {
  bin: "Bin",
  soap: "Soap",
  tp: "Toilet paper",
  plant: "Plant",
  vacuum: "Vacuum",
  litter: "Litter box",
  catfood: "Cat food",
  fridge: "Fridge",
  kettle: "Kettle",
  coffee: "Coffee",
  cart: "Shopping",
  wrench: "Wrench",
};

const iconTile = (name: GlyphName) => (
  <Glyph name={name} size={28} accent="var(--color-bm-text)" />
);

/**
 * A chore's icon as the glyphs themselves (issue #106), posted as `sprite`.
 * The first tile, posted empty (so `manage_chore` leaves the sprite as it
 * is), is what the chore shows now: "Current icon" for a chore whose sprite
 * is not one of CHORE_ICONS (a starter chore's), "Automatic" for a new one
 * (its name picks it). A chore already on one of the icons starts on it.
 */
export function ChoreIconPicker({
  sprite,
  value,
  onChange,
  disabled,
}: {
  /** The chore's `chores.sprite`, or undefined for a new chore. */
  sprite?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const onIcon = sprite !== undefined && isChoreIcon(sprite);
  const keep: TileOption[] = onIcon
    ? []
    : [
        {
          value: "",
          label: sprite === undefined ? "Automatic" : "Current icon",
          tile: iconTile(choreGlyph(sprite ?? "")),
        },
      ];
  return (
    <TilePicker
      legend="Icon"
      name="sprite"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={[
        ...keep,
        ...CHORE_ICONS.map((icon) => ({
          value: icon,
          label: CHORE_ICON_LABELS[icon],
          tile: iconTile(icon),
        })),
      ]}
    />
  );
}

/** Where a ChoreIconPicker starts: the chore's icon, or the first tile. */
export function choreIconValue(sprite?: string): string {
  return sprite !== undefined && isChoreIcon(sprite) ? sprite : "";
}

function isChoreIcon(sprite: string): sprite is ChoreIcon {
  return (CHORE_ICONS as readonly string[]).includes(sprite);
}

const title = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

function swatchesOf(
  ids: readonly string[],
  colours: Readonly<Record<string, string>>,
): SwatchOption[] {
  return ids.map((id) => ({
    value: id,
    colour: colours[id]!,
    label: title(id),
  }));
}

const HAIR_COLOUR_OPTIONS = swatchesOf(AVATAR_HAIR_COLORS, HAIR_COLOURS);
const SKIN_OPTIONS = swatchesOf(AVATAR_SKIN_TONES, SKIN_TONES);
const SHIRT_OPTIONS = swatchesOf(AVATAR_SHIRT_COLORS, SHIRT_COLOURS);

/**
 * The 16-bit character picker (ADR 0005 §5): a large live preview, the hair
 * styles as the character itself wearing each one (drawn by Housemate from
 * the other current choices), and hair colour, skin and shirt as swatches
 * of the palette Housemate draws with. Controlled; the radios are named
 * `hairStyle`, `hairColor`, `skinTone` and `shirtColor`, so the enclosing
 * form posts a whole `MemberAvatar`.
 */
export function CharacterPicker({
  avatar,
  onChange,
  disabled,
  previewLabel = "Your character",
}: {
  avatar: MemberAvatar;
  onChange: (avatar: MemberAvatar) => void;
  disabled?: boolean;
  previewLabel?: string;
}) {
  const set =
    <K extends keyof MemberAvatar>(key: K) =>
    (value: string) =>
      onChange({ ...avatar, [key]: value as MemberAvatar[K] });
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div
        data-testid="avatar-preview"
        data-hair-style={avatar.hairStyle}
        data-hair-color={avatar.hairColor}
        data-skin-tone={avatar.skinTone}
        data-shirt-color={avatar.shirtColor}
        className="pixel-frame flex justify-center self-start bg-bm-ink px-8 py-4"
      >
        <Housemate avatar={avatar} scale={8} label={previewLabel} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <TilePicker
          legend="Hair style"
          name="hairStyle"
          value={avatar.hairStyle}
          onChange={set("hairStyle")}
          disabled={disabled}
          captions
          options={AVATAR_HAIR_STYLES.map((style) => ({
            value: style,
            label: title(style),
            tile: (
              <Housemate avatar={{ ...avatar, hairStyle: style }} scale={3} />
            ),
          }))}
        />
        <SwatchPicker
          legend="Hair colour"
          name="hairColor"
          value={avatar.hairColor}
          onChange={set("hairColor")}
          disabled={disabled}
          options={HAIR_COLOUR_OPTIONS}
        />
        <SwatchPicker
          legend="Skin"
          name="skinTone"
          value={avatar.skinTone}
          onChange={set("skinTone")}
          disabled={disabled}
          options={SKIN_OPTIONS}
        />
        <SwatchPicker
          legend="Shirt"
          name="shirtColor"
          value={avatar.shirtColor}
          onChange={set("shirtColor")}
          disabled={disabled}
          options={SHIRT_OPTIONS}
        />
      </div>
    </div>
  );
}
