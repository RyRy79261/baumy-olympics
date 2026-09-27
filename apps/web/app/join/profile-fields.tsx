import { AVATAR_SPRITES, MEMBER_COLORS } from "@baumy/types";
import { Field, Input, Select } from "@baumy/ui";

/** The name, colour and avatar a new member picks, shared by both forms. */
export function ProfileFields({
  prefix,
  errors,
  pending,
}: {
  prefix: string;
  errors: Record<string, string[]>;
  pending: boolean;
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
    </>
  );
}
