---
slug: telegram-and-baumy-brain
title: Telegram and Baumy Brain
audience: member
url: /settings
covers:
  - apps/web/lib/brain
  - apps/web/lib/integrations/brain.ts
  - apps/web/lib/actions/create-telegram-link-code.ts
  - apps/web/lib/actions/link-telegram.ts
  - apps/web/lib/telegram/deep-link.ts
  - apps/web/lib/login-approval
  - docs/brain-integration.md
---

## What Baumy Brain is

Baumy Brain is the house's Telegram bot, {{TELEGRAM_BOT}}. It lives in the house's Telegram group and in your direct messages, and it is the same Baumy as in the app: it can read the bounties, scores, notes, reminders, the calendar and the pot, and do things in the app for you.

The **shopping list belongs to Baumy Brain**. "Buy milk" in the Telegram group and on the kitchen iPad is the same list, so whatever you add or tick off in one place shows in the other.

## Linking your Telegram account

Baumy Brain needs to know which housemate you are before it does anything for you.

1. In the app, open **Settings** and find **Telegram**.
2. Tap **Link Telegram**, then **Open Telegram**, then **Start** in the chat with {{TELEGRAM_BOT}}. On a laptop, scan the QR code with your phone instead.
3. The card says **Linked** once the bot has it.

If the button does not work, send `/link` and the code the card shows to {{TELEGRAM_BOT}} instead. A code lasts {{TELEGRAM_LINK_CODE_MIN}} minutes and works once; make a new one if it runs out. To switch to a different Telegram account, link again.

## What you can ask it

Anything you could ask Baumy in the app: "who's winning?", "what's on this weekend?", "I cleaned the bathroom", "add a note that the plumber comes Tuesday". It can also post reminders, and veto a points change that is waiting.

- It asks you to tap a **confirm button** before most changes, such as logging or disputing a chore, or changing or deleting something. Small things, like adding a note or a reminder, happen straight away.
- It can do something **for a housemate** too ("Jo took the trash out"), but only after you tap the confirm button, and the app records both of you. Disputing or undoing a chore is never done for someone else: that is their own word.
- An admin can add bounties, change them and record pot money from Telegram, only in their own name. Other admin things are only in the app.

## Signing in with Baumy

If the household has switched it on, the sign-in page has **Sign in with Baumy**: Baumy Brain messages you in Telegram with the device that is asking and some numbers, and you tap the number the sign-in screen shows. Tap **Deny** if it was not you. The same tap can also **confirm it's you** before a sensitive change in Settings.

## What Telegram sees

Everything in Telegram also passes through Telegram, and Baumy Brain may post the bounties, scores and notes in the house group. It runs messages through its own AI. More in [your data](/privacy#who-else-sees-what).
