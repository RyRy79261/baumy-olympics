---
slug: the-pot
title: The pot
audience: member
url: /pot
covers:
  - apps/web/app/(hub)/pot/page.tsx
  - apps/web/lib/actions/scoreboard.ts
  - apps/web/lib/actions/add-pot-contribution.ts
  - packages/core/src/scoring/standings.ts
---

## What the pot is

The housemates put money into a savings pot during the year. At the end of the season (the calendar year), whoever has the most points takes the whole pot.

The app only keeps the record. No money moves through it: you pay at the bank, the way the house agrees. Points are a game and have no cash value of their own.

## Seeing it

**Pot** shows how much is in it, who would win it if the season ended now, and each month's contributions with who paid and the running total. Baumy can tell you too: "how much is in the pot?"

## Adding money

Only an admin records money for the pot: on the Pot page, or by asking Baumy ("put €20 in the pot"), in the app or in Telegram, always in their own name. It is recorded for a month, by default this one, and says who paid.

## Who wins

The winner is whoever has the most season points: their scored chores plus any point adjustments two admins agreed on.

- If two people are level on points, the app breaks the tie from their chores this season and from who got to their total first.
- If nobody has any points, or the tie cannot be broken, there is no automatic winner and the owner decides.
- Claims can still be disputed for a short while after New Year, so the season closes, and the winner is written down, once every last claim has settled.
