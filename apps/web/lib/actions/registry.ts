import "server-only";

import type { ActionResult } from "./result";
import type { ActionDef, ActionName, AnyActionDef, RequestCtx } from "./define";
import { addPotContribution } from "./add-pot-contribution";
import { adjustPoints } from "./adjust-points";
import { attachCompletionPhoto } from "./attach-completion-photo";
import { createEvent, deleteEvent, listEvents, updateEvent } from "./calendar";
import { checkKioskPin } from "./check-kiosk-pin";
import {
  concedeCompletion,
  confirmCompletion,
  disputeCompletion,
  resolveDispute,
  undoCompletion,
  withdrawDispute,
} from "./confirmations";
import { createTelegramLinkCode } from "./create-telegram-link-code";
import { getPendingConfirmations } from "./get-pending-confirmations";
import { joinAsFounder } from "./join-as-founder";
import { linkTelegram } from "./link-telegram";
import { listChores } from "./list-chores";
import { logCompletionAction } from "./log-completion";
import { manageChore } from "./manage-chore";
import { manageMembers } from "./manage-members";
import {
  authorizeMcpClient,
  listMcpConnectionsAction,
  revokeMcpConnection,
} from "./mcp-connections";
import { mintInvite } from "./mint-invite";
import {
  createNote,
  deleteNote,
  listNotes,
  pinNote,
  updateNote,
} from "./notes";
import { pairKiosk } from "./pair-kiosk";
import { createProposer } from "./propose";
import { redeemInvite } from "./redeem-invite";
import { revokeInvite } from "./revoke-invite";
import { revokeKiosk } from "./revoke-kiosk";
import { createRunner } from "./run";
import { getPot, getStandings, getStreaks } from "./scoreboard";
import { setKioskPin } from "./set-kiosk-pin";
import {
  addShoppingItems,
  checkOffShoppingItems,
  listShopping,
} from "./shopping";
import { setPrizeMode } from "./set-prize-mode";
import { updateMyProfile } from "./update-my-profile";
import {
  dismissWeight,
  getWeights,
  scheduleWeight,
  vetoWeight,
} from "./weights";
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
  link_telegram: linkTelegram,
  authorize_mcp_client: authorizeMcpClient,
  list_mcp_connections: listMcpConnectionsAction,
  revoke_mcp_connection: revokeMcpConnection,
  pair_kiosk: pairKiosk,
  revoke_kiosk: revokeKiosk,
  check_kiosk_pin: checkKioskPin,
  list_chores: listChores,
  log_completion: logCompletionAction,
  manage_chore: manageChore,
  get_pending_confirmations: getPendingConfirmations,
  confirm_completion: confirmCompletion,
  dispute_completion: disputeCompletion,
  undo_completion: undoCompletion,
  withdraw_dispute: withdrawDispute,
  concede_completion: concedeCompletion,
  resolve_dispute: resolveDispute,
  attach_completion_photo: attachCompletionPhoto,
  get_standings: getStandings,
  get_streaks: getStreaks,
  get_pot: getPot,
  adjust_points: adjustPoints,
  add_pot_contribution: addPotContribution,
  set_prize_mode: setPrizeMode,
  get_weights: getWeights,
  schedule_weight: scheduleWeight,
  dismiss_weight: dismissWeight,
  veto_weight: vetoWeight,
  list_events: listEvents,
  create_event: createEvent,
  update_event: updateEvent,
  delete_event: deleteEvent,
  list_notes: listNotes,
  create_note: createNote,
  update_note: updateNote,
  pin_note: pinNote,
  delete_note: deleteNote,
  list_shopping: listShopping,
  add_shopping_items: addShoppingItems,
  check_off_shopping_items: checkOffShoppingItems,
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

/**
 * Check a write Claude asked for and preview it, without running it (the AI
 * command's proposals, SPEC §6.3). Approving runs it through `runAction`.
 */
export const proposeAction = createProposer(REGISTRY);

/** Whether `name` is a registered read, a write, or nothing at all. */
export function actionKind(name: string): "read" | "write" | undefined {
  return Object.hasOwn(REGISTRY, name)
    ? REGISTRY[name as ActionName].kind
    : undefined;
}
