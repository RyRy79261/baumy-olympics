// There is exactly one household (SPEC §5). Migration 0001 seeds it with this
// id, so every environment (Neon, Docker, PGlite) agrees on it without a
// lookup. A test checks the migration and these constants still match.

export const HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";
export const HOUSEHOLD_NAME = "Baumy household";
export const HOUSEHOLD_TZ = "Europe/Berlin";
