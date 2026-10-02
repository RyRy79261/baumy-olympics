# 0005: A portrait kitchen dashboard built around bounties

- Status: accepted (2026-09-28)

## Context

The owner and I prototyped the kitchen screen's look on branch `proto/kiosk-home-pixel` (`apps/web/app/prototype/dashboard/`, run it with `/prototype/dashboard?variant=A`). Three rounds were rejected along the way:

- neutral grey placeholders ("bland");
- busy game HUDs ("way too video game", "not informative");
- my own hand-drawn cats ("nightmare fuel").

The owner approved variant A with the month calendar and the Camp 404 cat ("the style is perfect").

## Decision

1. **The kitchen iPad is portrait, 820×1180.** Its home is a glanceable dashboard, readable across the room, that needs no taps to understand. From top to bottom:
   - a header with the date, a big clock and **at most three notification icons**: Urgent, New and Messages. Each is a 16-bit icon with a count badge, and it goes dim at zero. Tapping one opens a calm module (a sheet, not a toast) that lists that slice of the bounty board or the messages.
   - a **full-width month calendar**, the only home calendar view, with ◀ ▶ and a Today button. Each day cell shows as many event chips as fit, then "+N more". Tapping a day opens a day sheet with every event, large, stepping with ◀ ▶.
   - a **small footer nav**: Home, Bounties, Calendar, Board, Shop and Scores.
   - **Baumy** sits on the right, over the footer's end. It is a simple cat, and the speech bubbles come from it. Tapping it opens the voice command (§3.6).
2. **Chores are presented as bounties.** The data model keeps `chores`, and the scoring does not change. A chore gains a **kind**, `consumable` (buy or refill) or `maintenance` (clean or fix).
   - **Urgent** means state `due` and overdue, or falling due before Berlin midnight today. This is `list_chores`' existing split.
     - [CORRECTION 2026-10-01] Owner ruling (SPEC §12 decision 22, issue #127): urgent means overdue on the chore's own rhythm, its last completion plus the larger of the interval its weight implies and its cooldown. A chore never done, or with no rhythm, is never urgent; a never-done chore is only available, and New while recent.
   - **New** means created in the last 3 days.
3. **Messages are the notes board.** The Messages icon counts notes created or changed in the last 24 hours, and its module lists them. [CORRECTION 2026-10-02, issue #153, SPEC §12 decision 30] It counts the notes not every active member has seen since their words last changed, and its module lists those.
4. **Reminders are a new, small feature.**
   - A member (UI, AI, brain or kiosk) posts a reminder: a title and a short body.
   - The kiosk shows it **full-screen**, with every active member as their 16-bit character and a big "Seen" button under each.
   - Tapping yours records your acknowledgement. It is a kiosk write attributed to that member without a PIN, because it only says "I read this".
   - The reminder leaves the kiosk once every active member has seen it, or when a member dismisses it for everyone.
5. **Every member has a 16-bit character.** They choose it in Settings: hair style, hair colour, skin tone and shirt colour. There are defaults, so nobody has to choose. Names come from the members table, and nothing about the people is hard-coded.
   - [CORRECTION 2026-09-29] Owner rulings 2026-09-29: characters are pre-generated sets in an admin-managed gallery (issue #111), and the drawn (parametric) character is removed ("Burn it", issue #116). A member picks from the gallery in Settings; without a pick they show as their initial in their colour (`members.color`), which is also their colour everywhere. The app never draws a person.
6. **Screensaver.** The kitchen screen shows a dim night room with a clock, a sleeping Baumy, and 16-bit raccoons that knock over a bin, carry a sock and push a box. It shows during night hours (`KIOSK_NIGHT_HOURS`, replacing the night-mode look) and after 5 minutes untouched. Any tap wakes it, and that tap never reaches the page.
7. **The art.**
   - **Baumy** is Camp 404's INKBLOT cat (`camp-404 apps/join/components/os/inkblot-cat.ts`) at twice the pixels, through Scale2x, recoloured to the reference photo: a violet-black coat, a violet sheen and a green eye. It is not redrawn. [UNRESOLVED 2026-09-28] Camp 404 records that the sheet's source and licence (bat-cat `cat_sheet.png`) are unconfirmed; the owner should confirm we may ship it.
   - The icons are 16×16 "#"-grid glyphs in the Camp 404 style.
   - The palette comes from `design/baumy-reference.png`: a near-black plum background, violet, teal, pink, amber and yellow accents, and the green and blue of the cat's eyes.
   - The fonts are Press Start 2P for display text, Silkscreen for labels and Pixelify Sans for reading text.
   - The whole app is dark and high-contrast, with no scanlines and no glitch effects.
8. **Calm is a requirement.** On the home screen, one accent colour has one meaning. There are no tickers, no metric walls and no decoration that carries no information.

## Consequences

- The landscape kiosk home (SPEC §3.1, §8) is replaced. `/kiosk` becomes the portrait dashboard. The chores, calendar, notes and shopping pages remain behind the footer nav, restyled.
- **Migration:** `chores.kind` (default `maintenance`, so existing rows and the seed list stay valid), `members.avatar` (jsonb, nullable), `reminders` and `reminder_acks`.
- **New actions:** `set_chore_kind` (admin, UI only) or a `kind` field on `manage_chore`, `create_reminder`, `acknowledge_reminder`, `dismiss_reminder` and `update_avatar` ([CORRECTION 2026-09-29] removed by issue #116; `members.avatar` stays in the table, unused).
- The phone and laptop hub (`/`) and the admin pages take on the same kit, but they keep a normal scrolling layout.
- The prototype branch is the visual reference. It is never merged.
