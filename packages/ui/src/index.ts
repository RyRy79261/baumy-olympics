// @baumy/ui: the pixel UI kit (issue #7, ADR 0005). Its look lives here, in
// one place, on the tokens in apps/web/app/globals.css; pages only pick
// components and variants, never their own colours or borders. The art is
// the approved prototype's (proto/kiosk-home-pixel): Baumy is Camp 404's
// INKBLOT cat through Scale2x, and new glyphs go into pixel/glyphs.ts.

export { AppShell, navBadgeClass, navItemClass } from "./app-shell";
export { NavMenu } from "./nav-menu";
export { AuthFrame, linkClass } from "./auth-frame";
export { ProposalItem, SpeechBubble, type ProposalState } from "./baumy";
export {
  BAUMY_STATE_FRAMES,
  BaumyCat,
  baumyFrames,
  type BaumyFrameRef,
} from "./baumy-cat";
export { STATE_MARK } from "./baumy-states";
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
export { CheckItemButton, CheckList } from "./check-list";
export {
  ChoiceGroup,
  ChoreTile,
  ScorePop,
  StreakBrokenBanner,
  choreGlyph,
  type ChoiceOption,
  type ChoreTileProps,
  type ChoreTileState,
} from "./chores";
export { cx } from "./cx";
export { Dialog } from "./dialog";
export { Checkbox, Field, FormMessage, Input, Select, Textarea } from "./field";
export {
  HAIR_COLOURS,
  HAIR_STYLE_HEADS,
  Housemate,
  SHIRT_COLOURS,
  SKIN_TONES,
  housemateGrid,
  housematePalette,
} from "./housemate";
export {
  BaumyButton,
  ClockFace,
  HubGrid,
  Widget,
  WidgetItem,
  WidgetList,
  type WidgetStatus,
} from "./hub";
export { KioskIndicator, KioskNotice, NightScreen } from "./kiosk-night";
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
export { PixelBubble } from "./pixel-bubble";
export {
  BAUMY_COLOURS,
  BAUMY_FRAMES,
  BAUMY_H,
  BAUMY_W,
} from "./pixel/baumy-cat";
export { Glyph, PixelIcon, glyphShadow } from "./pixel/glyph";
export { GLYPHS, GLYPH_NAMES, type GlyphName } from "./pixel/glyphs";
export {
  PIXEL_ICONS,
  type PixelIconArt,
  type PixelIconName,
} from "./pixel/icons";
export { PixelArt, SpriteStrip, stripTiming } from "./pixel/pixel-art";
export {
  gridSize,
  gridToPaths,
  type Palette,
  type Sprite as PixelSprite,
} from "./pixel/pixel-grid";
export { scale2x } from "./pixel/scale2x";
export { ProofPhoto } from "./proof-photo";
export { RACCOON_FRAMES, RACCOON_PALETTE, Raccoon } from "./raccoon";
export { Points, Stat, StreakFlame, Table, Td, Th } from "./scores";
export { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PinPad } from "./pin-pad";
export { Sparkline, type SparklineProps } from "./sparkline";
export {
  BAUMY_STATES,
  SPRITE_MOTION,
  Sprite,
  type SpriteState,
} from "./sprite";
export { ToastItem, ToastList, toastDismissClass } from "./toast";
export { LevelMeter, MicButton, type MicState } from "./voice";
