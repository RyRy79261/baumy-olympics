import { AVATAR_SPRITES, MEMBER_COLORS } from "@baumy/types";
import { Field, Input, Select, type GalleryOption } from "@baumy/ui";
import { GalleryField } from "./gallery-field";

/** The name, colour and avatar a new member picks, shared by both forms. */
export function ProfileFields({
  prefix,
  errors,
  pending,
  gallery = [],
}: {
  prefix: string;
  errors: Record<string, string[]>;
  pending: boolean;
  /** The household's avatar gallery (issue #111), to pick from. */
  gallery?: readonly GalleryOption[];
}) {
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
      <Field id={`${prefix}-color`} label="Colour" errors={errors.color}>
        {(control) => (
          <Select
            {...control}
            name="color"
            defaultValue={MEMBER_COLORS[0]}
            disabled={pending}
          >
            {MEMBER_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id={`${prefix}-avatar`}
        label="Avatar"
        errors={errors.avatarSprite}
      >
        {(control) => (
          <Select
            {...control}
            name="avatarSprite"
            defaultValue={AVATAR_SPRITES[0]}
            disabled={pending}
          >
            {AVATAR_SPRITES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <GalleryField options={gallery} pending={pending} />
    </>
  );
}
