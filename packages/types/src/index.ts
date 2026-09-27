// @baumy/types: Zod schemas shared across boundaries (AGENTS.md "Validate with
// Zod at every boundary"). No I/O, no framework imports.

export { Surface, SURFACES } from "./surface";
export {
  AVATAR_SPRITES,
  AvatarSprite,
  DISPLAY_NAME_MAX,
  DisplayName,
  KioskPin,
  MEMBER_COLORS,
  MemberColor,
  MemberRole,
} from "./member";
export {
  KIOSK_DEVICE_NAME_MAX,
  KIOSK_PAIRING_CODE_LENGTH,
  KioskDeviceName,
  KioskPairingCode,
} from "./kiosk";
export {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  BasePoints,
  CHORE_NAME_MAX,
  COMPLETION_NOTE_MAX,
  COOLDOWN_HOURS_MAX,
  ChoreName,
  CompletionNote,
  ConfirmMode,
  CooldownHours,
  DISPUTE_REASON_MAX,
  DisputeReason,
  EFFORT_FACTOR_MAX,
  EFFORT_FACTOR_MIN,
  EffortFactorPct,
  ProofMode,
  cooldownMinutesFromHours,
} from "./chore";
export {
  ADJUSTMENT_POINTS_MAX,
  ADJUSTMENT_REASON_MAX,
  AdjustmentPoints,
  AdjustmentReason,
  POT_AMOUNT_MAX_CENTS,
  POT_NOTE_MAX,
  PotAmountCents,
  PotMonth,
  PotNote,
  PrizeMode,
  potMonthDate,
} from "./scores";
