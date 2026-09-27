// @baumy/ui: the UI kit. NEUTRAL PLACEHOLDERS until the pixel UI kit
// (issue #7) restyles them here, in one place; pages only pick components and
// variants, never their own colours or borders.

export { AppShell, navItemClass } from "./app-shell";
export { ProposalItem, SpeechBubble, type ProposalState } from "./baumy";
export {
  Button,
  buttonClass,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./button";
export {
  CalendarDayCell,
  CalendarEventButton,
  CalendarGrid,
  type CalendarEventButtonProps,
} from "./calendar";
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
export { Checkbox, Field, FormMessage, Input, Select, Textarea } from "./field";
export {
  BaumyButton,
  ClockFace,
  HubGrid,
  Widget,
  WidgetItem,
  WidgetList,
  type WidgetStatus,
} from "./hub";
export {
  AvatarButton,
  KioskShell,
  type AvatarButtonProps,
} from "./kiosk-shell";
export {
  MarkdownBody,
  NOTE_SANITIZE_SCHEMA,
  isAllowedNoteUrl,
} from "./markdown";
export { NoteGrid, StickyNote } from "./note";
export { PageHeading } from "./page-heading";
export { ProofPhoto } from "./proof-photo";
export { Points, Stat, StreakFlame, Table, Td, Th } from "./scores";
export { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PinPad } from "./pin-pad";
export { Sparkline, type SparklineProps } from "./sparkline";
export {
  BAUMY_STATES,
  SPRITE_MOTION,
  Sprite,
  type SpriteState,
} from "./sprite";
export { LevelMeter, MicButton, type MicState } from "./voice";
