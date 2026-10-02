# Kitchen iPad setup

How to turn the iPad into the always-on kitchen screen (SPEC §8, issue #29).

## 1. Pair it, then install it to the home screen

1. Pair the iPad by scanning it (issue #126). Nothing is typed on the iPad:
   1. On the iPad, open `https://<production host>/kiosk` in Safari. It
      is not paired yet, so it shows **Make this the kitchen screen** with
      a big QR code and a short code (`ABC-234`) under it.
   2. On your phone, signed in to Baumy as an admin, point the camera at
      the QR code and open the link.
   3. The phone asks **Make this iPad the kitchen screen?** with the code
      (check it matches the iPad), the browser that asked and the name
      "Kitchen". Tap **Make it the kitchen screen**. Only approve a code
      you can see on the iPad in front of you: a link someone sent you
      could be for their own device. If the phone says the code was asked
      for from a different network (for example, the phone is on mobile
      data), that is fine only if you are standing at the iPad.
   4. The iPad switches to the kitchen home by itself within a couple of
      seconds.

   If the camera will not read the code, open Admin → **Kitchen screen** on
   the phone and type the short code instead. A code lasts 10 minutes and
   works once; the iPad shows a new one by itself. Rename the screen or sign
   it out on Admin → Kitchen screen.

   This is not the **personal PIN** in Settings: that is each housemate's
   own 4 to 6 digits, which the kitchen screen asks for before it confirms
   something as them. Pairing needs no PIN.

2. On `/kiosk`, tap Share → **Add to Home Screen**. Keep the name "Baumy".
3. Open Baumy from the home screen. It opens full screen, with no Safari
   bars (`display: standalone` in `app/manifest.ts`, and `appleWebApp`
   in the root layout).

The manifest says `orientation: portrait` (the kitchen dashboard, ADR
0005), but iPadOS ignores that for home-screen apps. Hold the iPad upright,
in portrait, and lock the rotation (Control Centre → Rotation Lock), or let
Guided Access hold it (below).

## 2. Keep it awake

The kiosk asks for the Screen Wake Lock every time it opens, every time it
comes back into view and on any touch while it does not hold it. iPadOS
supports it from 16.4 in Safari and in home-screen apps. While the lock is
not held, a tag in the bottom-left corner, just above the footer nav,
says:

- **Screen may sleep**: the browser refused or dropped the lock (Low Power
  Mode, the page was hidden). Touch the screen and it asks again.
- **Screen cannot stay on**: this browser has no wake lock at all (iPadOS
  before 16.4). Update iPadOS, or rely on Auto-Lock below.

The wake lock is best effort, so set the fallback as well:

1. Settings → Display & Brightness → **Auto-Lock → Never**.
2. Settings → Battery → Low Power Mode **off** (it overrides the wake lock
   and Auto-Lock).
3. Keep the iPad on its charger.

## 3. Lock it to the app (Guided Access)

Guided Access keeps the iPad in Baumy: no swiping home, no notifications.

1. Settings → Accessibility → **Guided Access → On**.
2. Passcode Settings → Set Guided Access Passcode (keep it somewhere the
   household can find it). Turn Face ID/Touch ID on if you like.
3. Settings → Accessibility → Guided Access → **Display Auto-Lock → Never**.
   Guided Access has its own auto-lock, and it wins over the one in Display
   & Brightness.
4. Open Baumy from the home screen, triple-click the top (or home) button,
   and tap **Start**. Under Options, turn **Motion** off to hold portrait.
5. To leave it: triple-click, type the passcode, End.

## 4. Talking to Baumy

Tap the cat (and your avatar, if nobody is tapped in): the bubble shows a
big **Hold to talk**. Hold it while you speak, the button turns red with
moving bars, and let go: Baumy's answer and its cards (Confirm all,
Cancel) show in the same bubble, and Hold to talk is there again for the
next thing. Done, or a tap on the cat, closes it. A clip stops at 45
seconds; if Baumy heard only silence it says "I didn't hear anything —
hold and speak." and sends nothing.

The first tap asks for the microphone. iPadOS shows "Allow … to use your
microphone?": tap **Allow**. To stop it asking, Settings → Apps → Safari
→ **Microphone → Allow** (on older iPadOS, Settings → Safari →
Microphone). A home-screen app may still ask again after it is restarted.
While the bubble is open the microphone is on and iPadOS shows its orange
dot; it turns off when the bubble closes. If the microphone was refused,
the cat opens the typing sheet instead and says so; allow it in the same
setting and reload.

## 5. What the screen does on its own

- **Idle reset.** After 60 seconds untouched it forgets who tapped their
  avatar and goes back to the kitchen home, from any kiosk page, and closes
  any open sheet or PIN pad. The last 10 seconds show a countdown; any
  touch cancels it. On the home, a day sheet or module left open closes,
  and another month left showing goes back to this one. Holding "Hold to
  talk", and Baumy working on the answer, do not count as untouched: the
  minute starts again when the answer is there.
- **Night mode.** From 23:00 to 06:30 Berlin time it dims to a sleeping
  Baumy and a big clock. A touch wakes it; after a minute untouched it goes
  back to sleep; 06:30 wakes it for good. The hours are
  `KIOSK_NIGHT_HOURS` (`"23:00-06:30"` by default, `"off"` to turn it off;
  see SETUP.md). The screen does not dim the backlight itself: a web page
  cannot. Lower the brightness in Control Centre if the night screen is too
  bright.
- **Offline.** If the server cannot be reached when a page loads, it shows
  "No connection" instead of Safari's error page, and reloads itself as
  soon as the connection is back (and every minute). Nothing is stored for
  offline use.
- **Freshness.** The kitchen home and the Shop page re-read themselves
  every 60 seconds and when they come back into view (issues #20, #65).

## 6. Checks before calling it done

- [ ] Launched from the home screen, it is full screen in portrait.
- [ ] **2-hour soak test:** leave it on the kitchen home, untouched, for two
      hours in the day. The screen stays on, the corner tag never appears,
      and the clock is still ticking. Note the iPadOS version and the result
      in the PR or issue #29.
- [ ] Tap an avatar, open Chores, walk away: after 50 seconds the countdown
      shows, after 60 the screen is home, and Chores says "Tap your
      avatar".
- [ ] After 23:00 (or with `KIOSK_NIGHT_HOURS` set to the next few minutes
      on a preview): the night screen shows, a tap wakes it, a minute
      later it sleeps again, and in the morning it is awake.
- [ ] Tap the cat and your avatar, allow the microphone, hold **Hold to
      talk** and say "who's winning?": the button turns red with moving
      bars while held, and on letting go Baumy answers in the bubble, with
      Hold to talk under the answer.
- [ ] Turn Wi-Fi off and reload: "No connection". Turn it on: the kiosk is
      back by itself.
- [ ] Lighthouse (Chrome DevTools → Lighthouse, device Desktop, on
      `/kiosk` of a paired Chrome): no accessibility errors. Lighthouse 12
      dropped its PWA category; check installability in DevTools →
      Application → Manifest instead (no errors or warnings).
