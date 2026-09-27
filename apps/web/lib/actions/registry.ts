import "server-only";

import type { ActionResult } from "./result";
import type { ActionDef, ActionName, AnyActionDef, RequestCtx } from "./define";
import { checkKioskPin } from "./check-kiosk-pin";
import { createTelegramLinkCode } from "./create-telegram-link-code";
import { joinAsFounder } from "./join-as-founder";
import { listChores } from "./list-chores";
import { logCompletionAction } from "./log-completion";
import { manageChore } from "./manage-chore";
import { manageMembers } from "./manage-members";
import { mintInvite } from "./mint-invite";
import { pairKiosk } from "./pair-kiosk";
import { redeemInvite } from "./redeem-invite";
import { revokeInvite } from "./revoke-invite";
import { revokeKiosk } from "./revoke-kiosk";
import { createRunner } from "./run";
import { setKioskPin } from "./set-kiosk-pin";
import { updateMyProfile } from "./update-my-profile";
import { whoami } from "./whoami";

// Every action the product offers (ADR 0002). Typed against ACTION_NAMES in
// define.ts, so the list and this map cannot drift apart.

export const REGISTRY = {
  whoami,
  update_my_profile: updateMyProfile,
  redeem_invite: redeemInvite,
  join_as_founder: joinAsFounder,
  mint_invite: mintInvite,
  revoke_invite: revokeInvite,
  manage_members: manageMembers,
  set_kiosk_pin: setKioskPin,
  create_telegram_link_code: createTelegramLinkCode,
  pair_kiosk: pairKiosk,
  revoke_kiosk: revokeKiosk,
  check_kiosk_pin: checkKioskPin,
  list_chores: listChores,
  log_completion: logCompletionAction,
  manage_chore: manageChore,
} satisfies { [N in ActionName]: AnyActionDef & { name: N } };

export type ActionOutput<N extends ActionName> =
  (typeof REGISTRY)[N] extends ActionDef<infer _I, infer O, N> ? O : never;

const runner = createRunner(REGISTRY);

/**
 * The one way to run an action, from every surface (SPEC §6.3). Adapters that
 * take a name from outside (AI, MCP, brain) pass a plain string and get
 * UNKNOWN_ACTION for anything unregistered.
 */
export function runAction<N extends ActionName>(
  name: N,
  rawInput: unknown,
  ctx: RequestCtx,
): Promise<ActionResult<ActionOutput<N>>>;
export function runAction(
  name: string,
  rawInput: unknown,
  ctx: RequestCtx,
): Promise<ActionResult<unknown>>;
export function runAction(
  name: string,
  rawInput: unknown,
  ctx: RequestCtx,
): Promise<ActionResult<unknown>> {
  return runner(name, rawInput, ctx);
}
