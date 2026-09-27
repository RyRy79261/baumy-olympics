// `@/lib/auth`: who is asking (actor.ts). What they may do is lib/auth/gates.ts,
// which only runAction calls.
export {
  getActor,
  getActorOrRedirect,
  redirectIfSignedIn,
  type Actor,
  type ActorKind,
  type KioskActor,
  type McpActor,
  type MemberActor,
  type MemberRole,
  type ServiceActor,
} from "./actor";
export {
  pageGate,
  requireAdminPage,
  requireJoiningPage,
  requireMemberPage,
  type PageMember,
  type PageNeed,
  type PageVerdict,
} from "./page-gate";
