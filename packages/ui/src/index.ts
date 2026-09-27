// @baumy/ui: the UI kit. NEUTRAL PLACEHOLDERS until the pixel UI kit
// (issue #7) restyles them here, in one place; pages only pick components and
// variants, never their own colours or borders.

export { AppShell, navItemClass } from "./app-shell";
export {
  Button,
  buttonClass,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./button";
export { Card } from "./card";
export {
  ChoiceGroup,
  ChoreTile,
  ScorePop,
  StreakBrokenBanner,
  type ChoiceOption,
  type ChoreTileProps,
  type ChoreTileState,
} from "./chores";
export { cx } from "./cx";
export { Dialog } from "./dialog";
export { Field, FormMessage, Input, Select, Textarea } from "./field";
export {
  AvatarButton,
  KioskShell,
  type AvatarButtonProps,
} from "./kiosk-shell";
export { PageHeading } from "./page-heading";
export { ProofPhoto } from "./proof-photo";
export { Points, Stat, StreakFlame, Table, Td, Th } from "./scores";
export { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PinPad } from "./pin-pad";
export { Sprite, type SpriteState } from "./sprite";
