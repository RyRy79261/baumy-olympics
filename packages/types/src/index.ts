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
