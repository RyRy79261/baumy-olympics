-- Custom migration: seed the one household (SPEC §5). The id, name and tz
-- match packages/db/src/household.ts, and a PGlite test checks they still do.
-- Idempotent: re-running it changes nothing, and it never overwrites a name
-- someone has since edited.
INSERT INTO "households" ("id", "name", "tz")
VALUES ('00000000-0000-4000-8000-000000000001', 'Baumy household', 'Europe/Berlin')
ON CONFLICT ("id") DO NOTHING;
