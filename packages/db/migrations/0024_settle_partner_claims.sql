-- Custom migration (issue #150, SPEC §12 decision 29): there is no confirming
-- any more, so the partner confirm mode goes. Every self-claim counts at once
-- and settles when its 24h challenge window ends. The next migration drops
-- `chores.confirm_mode`; this one first moves the data the mode left behind.
-- Idempotent: once it has run, no row matches any of the three statements.

-- 1. A partner-mode claim nobody confirmed within 72h was already voided on
--    every read (`unconfirmed`); write that down, as the daily job would.
UPDATE "completions" AS c
SET "status" = 'voided', "void_reason" = 'unconfirmed'
FROM "chores" AS ch
WHERE ch."id" = c."chore_id"
  AND ch."confirm_mode" = 'partner'
  AND c."status" = 'pending'
  AND c."finalizes_at" IS NULL
  AND c."logged_at" + interval '72 hours' <= now();
--> statement-breakpoint

-- 2. Every other open self-claim with no `finalizes_at` (a partner-mode claim
--    still waiting, or one left from a chore switched away from partner mode)
--    gets the end of its challenge window, the time it settles at.
UPDATE "completions"
SET "finalizes_at" = "logged_at" + interval '24 hours'
WHERE "status" IN ('pending', 'disputed')
  AND "finalizes_at" IS NULL
  AND "logged_by" = "done_by";
--> statement-breakpoint

-- 3. No chore waits for a partner any more.
UPDATE "chores" SET "confirm_mode" = 'optimistic' WHERE "confirm_mode" = 'partner';
