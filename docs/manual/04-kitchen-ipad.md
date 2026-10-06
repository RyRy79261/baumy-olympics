---
slug: kitchen-ipad
title: The kitchen iPad
audience: member
url: /kiosk
covers:
  - apps/web/app/kiosk
  - apps/web/components/kiosk
  - apps/web/lib/kiosk/constants.ts
  - apps/web/lib/kiosk/night.ts
  - apps/web/lib/ai/voice.ts
  - apps/web/app/(hub)/admin/kitchen-screen/page.tsx
  - docs/kiosk-setup.md
  - apps/web/components/hub/set-pin-nudge.tsx
---

## What it shows

The iPad on the kitchen wall is the house's shared screen. Its home shows the date and the clock, the **Urgent**, **New** and **Messages** icons (tap one to see those bounties or notes), the month's calendar, and Baumy at the bottom. The bar along the bottom goes to Bounties, Calendar, Board, Activity, Shop and Scores. **Activity** is what happened in the house, newest first; a chore is disputed from there.

The **Messages** number on the iPad counts the notes that not everyone in the house has read yet, so it stays until every member has read them. Tap your avatar first, then open **Messages** or the **Board**: that marks those notes read for you only. With nobody picked, looking marks nothing. Reading them on your phone counts too.

Anyone can look. To change anything, say who you are first: **tap your avatar** (on the home, Baumy asks who is talking). Tap **Done** when you finish, so the next person does not act as you.

Changed your mind? Anything that opens over the screen closes with the **×** in its corner, or with a tap on the dimmed screen around it. A bounty's **Log** sheet also has **Cancel**, and either way nothing is logged.

After {{KIOSK_IDLE_DEFAULT_MIN}} minutes untouched, the screen forgets who was acting and goes back home by itself; the last few seconds show a countdown, and any touch cancels it. To change how long it waits, tap your avatar, open **Bounties → Kitchen screen settings** and pick {{KIOSK_IDLE_CHOICES_MIN}} minutes; it is saved for this screen.

## Your personal PIN

The kitchen screen is shared, but almost everything there runs as whoever tapped their avatar, with no PIN: logging a chore (for yourself or someone else), undoing, notes, the calendar, the shopping list and Baumy. The iPad asks for **your personal PIN** only before it **disputes** a chore as you, and, for an admin, before it adds or edits a bounty or changes a bounty's points. Your own settings are only changed on your phone.

If you have not set a PIN, the iPad never shows a PIN pad you cannot use: it says "<your name> hasn't set a personal PIN yet" with a QR code that opens Settings on your phone. When you ask Baumy for several things, **Confirm all** does the rest and leaves only the dispute waiting. After you join, a line at the top of the hub reminds you to set one; tap its × to hide it on that device.

Set your PIN on your phone, in **Settings → Your personal PIN**: {{KIOSK_PIN_MIN_DIGITS}} to {{KIOSK_PIN_MAX_DIGITS}} digits, yours alone. Changing a PIN you already have asks you to confirm it's you first. On the iPad, **Check my PIN** on the Bounties page checks it without changing anything. Keep it to yourself, and never use someone else's.

## Talking to Baumy

1. Tap the cat. If nobody is acting yet, tap your avatar too.
2. The bubble shows a big **Hold to talk**. Hold it while you speak; the button turns red with moving bars.
3. Let go. Baumy's answer, and any cards for things to change, show in the same bubble. **Confirm all** or **Cancel**, the same as on your phone.

Hold to talk stays there for the next thing. **Done**, or a tap on the cat, closes the bubble and turns the microphone off. A clip stops at {{KIOSK_CLIP_MAX_SECONDS}} seconds, and if Baumy heard only silence it says so and sends nothing. The first time, the iPad asks to use the microphone: tap **Allow**. "Type instead" opens a keyboard.

## Reminders

Something everyone must read (a plumber coming, the water off) can be posted as a **reminder**, from the hub, by Baumy or in Telegram. The kitchen screen shows it full-screen, with everyone's face. Each person taps their own face for **I've seen it**; when everyone has, it goes. **Dismiss for everyone** takes it down sooner, and asks who is dismissing it.

## When it rests

- After {{SCREENSAVER_IDLE_MIN}} minutes untouched in the day, and every night from {{NIGHT_START}} to {{NIGHT_END}}, it shows the raccoon screensaver with a big clock. A tap wakes it; the tap never presses anything underneath.
- With no internet it says "No connection" and comes back by itself.

## Admin things on the iPad

An admin can do a few admin things on the kitchen iPad, after tapping their own avatar, each with their personal PIN:

- **Add or edit a bounty**: ask Baumy ("add a bounty for the recycling, 15 points"); **Confirm all** asks for your PIN.
- **Change a bounty's points**: **Bounties → Kitchen screen settings → Change a bounty's points**. Like on your phone, the change waits for the next Monday at least {{WEIGHT_VETO_LEAD_H}} hours ahead, so the others can veto it.
- **Edit many bounties at once**: **Bounties → Kitchen screen settings → Edit bounties**. Each bounty has its own row: its name, kind, points, cooldown, photo proof, effort, and whether it is on the board or archived. Change as many rows as you like (changed rows are marked **Changed**), then tap **Save** once (it stays at the bottom of the screen) and type your PIN. A number left empty says **Required** until you fill it in. Either every change is saved or none is, and it says why. **Discard** throws the changes away. New points count from now on.

Everything else an admin does (members, the pot, pairing) stays on your phone.

## Pairing the iPad

Pairing makes an iPad the household's kitchen screen. Only an admin can do it, and it needs no PIN.

1. On the iPad, open Baumy Olympics at /kiosk. An iPad that is not paired shows **Make this the kitchen screen**, a QR code and a short code.
2. The admin scans the QR code with their phone (signed in), checks the code matches the iPad, and taps **Make it the kitchen screen**. The iPad switches to the kitchen home within a few seconds.
3. If the camera will not read it, the admin types the short code in **Admin → Kitchen screen** instead.

A code lasts {{KIOSK_PAIRING_CODE_MIN}} minutes and works once; the iPad shows a new one by itself. Only approve a code you can see on the iPad in front of you. The admin can rename the kitchen screen or sign it out in **Admin → Kitchen screen**.
