// The password policy, shared by the auth server (config.ts) and the sign-up
// and reset forms, so the form never accepts what the server refuses. Kept in
// its own module with no imports so client components can use it without
// pulling in Better Auth or the database driver.
//
// The numbers are camp-404's (`packages/core/src/password.ts`): NIST
// SP 800-63B-4 asks for 15 characters when a password is the only factor and
// favours length over composition rules, and 128 caps the work a single hash
// can be made to do.

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;
