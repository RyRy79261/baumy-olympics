---
slug: bounties-and-points
title: Bounties and points
audience: member
url: /chores
covers:
  - packages/core/src/scoring/ruleset.ts
  - packages/core/src/scoring/points.ts
  - packages/core/src/scoring/verification.ts
  - packages/core/src/scoring/frequency.ts
  - apps/web/lib/chores/urgency.ts
  - apps/web/components/chores/chore-grid.tsx
  - apps/web/components/activity/activity-log.tsx
  - apps/web/app/(hub)/chores/history/page.tsx
---

## Bounties

Every chore is a bounty. Each one has:

- a **kind**: a _consumable_ is something bought or refilled (amber), and _maintenance_ is something cleaned or fixed (teal);
- its **points**, the base it pays;
- a **cooldown**: once anyone has done it, nobody can log it again until the cooldown has passed, so the same bin cannot be taken out twice in an hour.

A bounty is **urgent** when it is overdue on its own rhythm, or falls due before midnight. A bounty that has never been done is never urgent. It is **new** for its first {{NEW_BOUNTY_DAYS}} days.

## Logging a chore

Open **Bounties**, pick the chore and tap **Log it**. You can also tell Baumy ("I did the dishes"), the kitchen iPad, or Baumy in Telegram.

- You can log a chore up to {{MAX_BACKDATE_H}} hours after you did it, but never in the future, and never before the chore's last completion.
- You can log a chore for a housemate ("Jo did the dishes"). It is logged in their name, by you.
- Some bounties need a **proof photo**; those can only be logged with one.
- If you logged something by mistake, **Undo** it within {{UNDO_WINDOW_MIN}} minutes.

## Disputing

When a chore is logged, its points count straight away, shown dimmed as provisional. There is no confirming: nobody has to OK a chore.

- Another housemate can **dispute** a logged chore from **Activity** within the dispute window, {{CHALLENGE_WINDOW_H}} hours after it was logged, with a reason. If nobody does, the points are final when the window ends. On the kitchen iPad a dispute asks for your personal PIN; nothing else about chores does.
- A disputed chore scores nothing while it is disputed. If the person who did it attached a photo in time, it waits for them and the person who disputed (or an admin) to settle it; otherwise it is dropped when the window ends.
- The person who disputed can **withdraw** the dispute, and the person who did the chore can **concede** it.

## How points work

Points are kept per bounty, for the season (one calendar year).

- **Streaks.** Doing the same bounty again, with nobody else doing it in between, builds your streak on it. Each time in a row pays {{STREAK_STEP_PCT}}% of the bounty's points more than the time before, with no limit. Time alone never ends a streak; only someone else doing that bounty does.
- **Breaking a streak.** When you do a bounty someone else holds the streak on, you take it over (your streak starts at 1) and get a break bonus on top: {{BREAK_PCT_PER_LENGTH}}% of the bounty's points for every time in the streak you broke, up to {{BREAK_MAX_PCT}}% for a streak of {{BREAK_LENGTH_CAP}} or more.
- **Nobody loses points.** The person whose streak was broken keeps everything they scored.
- Every streak starts again on 1 January.

So doing a chore over and over pays more and more, and leaving a chore to one person makes it worth more to everyone else.

## When a bounty's points change

Baumy watches how often each bounty is really done. Each week it may suggest new points for one that is done much more or less often than its points expect; a suggestion lands between {{SUGGESTED_POINTS_MIN}} and {{SUGGESTED_POINTS_MAX}} points.

An admin can schedule a suggestion, or set any bounty's points with a reason. A scheduled change lands on a Monday at least {{WEIGHT_VETO_LEAD_H}} hours away, and until then any other member can **veto** it in **Activity**. An admin can also change points at once when they edit a bounty, or edit many bounties together under **Admin → Edit chores → Edit many at once**: one row per bounty (points, cooldown and effort are sliders, and points also have **−** and **+** for one point at a time), one **Save**, and either every change is saved or none is. A change never touches points already scored.

Every change, who made it and why, is in **Points history** under the bounties board.

## Proof photos

A proof photo is only shown inside the app, to the household. It is deleted {{PHOTO_RETENTION_DAYS}} days after its claim settled. More in [your data](/privacy#how-long-we-keep-it).
