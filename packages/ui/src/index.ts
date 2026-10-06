// @baumy/ui: the pixel UI kit (issue #7, ADR 0005). Its look lives here, in
// one place, on the tokens in apps/web/app/globals.css; pages only pick
// components and variants, never their own colours or borders. The art is
// the approved prototype's (proto/kiosk-home-pixel): Baumy is Camp 404's
// INKBLOT cat through Scale2x, and new glyphs go into pixel/glyphs.ts.

export { AppShell, navBadgeClass, navItemClass } from "./app-shell";
export { NavMenu } from "./nav-menu";
export { AuthFrame, linkClass } from "./auth-frame";
export { ProposalItem, SpeechBubble, type ProposalState } from "./baumy";
export { BaumyBadge } from "./baumy-badge";
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
  CalendarChip,
  CalendarDayCell,
  CalendarEventButton,
  CalendarMore,
  CalendarGrid,
  type CalendarEventButtonProps,
} from "./calendar";
export {
  AgendaItem,
  BOUNTY_KIND_LABEL,
  BountyGlyph,
  BountyList,
  BountyRow,
  BountySummary,
  StatusTileFace,
  TabLabel,
  statusTileClass,
  tabClass,
  type BountyFields,
  type BountyKind,
  type BountyRowProps,
  type TabAccent,
} from "./bounties";
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
  type ScorePopBox,
} from "./chores";
export { cx } from "./cx";
export { Dialog } from "./dialog";
export {
  DIALOG_TYPED_EVENT,
  forceCloseDialog,
  isTypedInput,
} from "./use-modal-dialog";
export { Checkbox, Field, FormMessage, Input, Select, Textarea } from "./field";
export { AvatarGallery, type GalleryOption } from "./avatar-gallery";
export {
  BUST_FRACTION,
  BUST_MAX_PX,
  CHARACTER_SLOT_PX,
  MemberCharacter,
  contrastRatio,
  initialOf,
  initialTileColours,
  type InitialTileColours,
  spriteFactor,
  spriteFit,
} from "./member-character";
export {
  BaumyButton,
  ClockFace,
  HubGrid,
  Widget,
  WidgetItem,
  WidgetList,
  type WidgetStatus,
} from "./hub";
export { KioskNotice } from "./kiosk-night";
export {
  AvatarButton,
  KioskShell,
  KioskTopBar,
  type AvatarButtonProps,
} from "./kiosk-shell";
export {
  ActingChip,
  HOUSE_COLOUR,
  ModuleBountyRow,
  DayEventRow,
  EventChip,
  KIOSK_FOOTER_H,
  KioskFooter,
  KioskNavItem,
  MessageRow,
  ModuleEmpty,
  ModulePanel,
  MonthDayCell,
  NotificationIcon,
  SheetTabs,
  WeekdayRow,
  WhoLine,
  actingDoneClass,
  bountyActionClass,
  kioskArrowClass,
  kioskNavItemClass,
  tint,
  todayButtonClass,
  toneColour,
  type DashboardTone,
} from "./kiosk-dashboard";
export { KioskModal } from "./kiosk-modal";
export {
  PixelScroll,
  seekTo,
  thumbFor,
  type ScrollMetrics,
} from "./pixel-scroll";
export {
  MarkdownBody,
  NOTE_SANITIZE_SCHEMA,
  isAllowedNoteUrl,
} from "./markdown";
export { NoteGrid, StickyNote } from "./note";
export { PageHeading, SectionHeading } from "./page-heading";
export { PixelBubble } from "./pixel-bubble";
export {
  CHORE_ICON_LABELS,
  ChoreIconPicker,
  choreIconValue,
  Swatch,
  SwatchPicker,
  TilePicker,
  memberColourOptions,
  type SwatchOption,
  type TileOption,
} from "./pickers";
export {
  CatBubble,
  CatButton,
  CatLink,
  CatSays,
  CatText,
  HoldToTalk,
  LevelBars,
  type HoldState,
} from "./cat-bubble";
export {
  BADGE_COLOURS,
  BADGE_GRID,
  BADGE_PALETTE,
  BADGE_RIM,
  BADGE_SIZE,
  BADGE_SPARKLES,
  badgeCat,
} from "./pixel/baumy-badge";
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
export { ReminderScreen, type ReminderFace } from "./reminder-screen";
export { SCREENSAVER_ART, Screensaver } from "./screensaver";
export { Points, Stat, StreakFlame, Table, Td, Th } from "./scores";
export { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PinPad } from "./pin-pad";
export { Slider, stepStops, stopIndex, withStop } from "./slider";
export { Sparkline, type SparklineProps } from "./sparkline";
export {
  BAUMY_STATES,
  SPRITE_MOTION,
  Sprite,
  type SpriteState,
} from "./sprite";
export { ToastItem, ToastList, toastDismissClass } from "./toast";
export { LevelMeter, MicButton, type MicState } from "./voice";
