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
---

## What it shows

The iPad on the kitchen wall is the house's shared screen. Its home shows the date and the clock, the **Urgent**, **New** and **Messages** icons (tap one to see those bounties or notes), the month's calendar, and Baumy at the bottom. The bar along the bottom goes to Bounties, Calendar, Board, Shop and Scores.

Anyone can look. To change anything, say who you are first: **tap your avatar** (on the home, Baumy asks who is talking). Tap **Done** when you finish, so the next person does not act as you.

After {{KIOSK_IDLE_SECONDS}} seconds untouched, the screen forgets who was acting and goes back home by itself; the last few seconds show a countdown, and any touch cancels it.

## Your personal PIN

The kitchen screen is shared, so the kitchen iPad asks for **your personal PIN** for some actions, before it does them as you. Your own settings are only changed on your phone.

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

## Pairing the iPad

Pairing makes an iPad the household's kitchen screen. Only an admin can do it, and it needs no PIN.

1. On the iPad, open Baumy Olympics at /kiosk. An iPad that is not paired shows **Make this the kitchen screen**, a QR code and a short code.
2. The admin scans the QR code with their phone (signed in), checks the code matches the iPad, and taps **Make it the kitchen screen**. The iPad switches to the kitchen home within a few seconds.
3. If the camera will not read it, the admin types the short code in **Admin → Kitchen screen** instead.

A code lasts {{KIOSK_PAIRING_CODE_MIN}} minutes and works once; the iPad shows a new one by itself. Only approve a code you can see on the iPad in front of you. The admin can rename the kitchen screen or sign it out in **Admin → Kitchen screen**.
