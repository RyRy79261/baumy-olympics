"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReminderScreen } from "@baumy/ui";
import {
  kioskDismissReminderAction,
  kioskRemindersAction,
  kioskSeenReminderAction,
} from "@/app/kiosk/reminder-actions";
import type { ListRemindersData, ReminderView } from "@/lib/actions/reminders";
import { REMINDER_POLL_MS } from "@/lib/kiosk/constants";
import { NIGHT_EVENT, type NightEventDetail } from "@/lib/kiosk/night";
import {
  markSeen,
  reminderFaces,
  withoutReminder,
} from "@/lib/kiosk/reminders";
import { newRequestId } from "../use-action-form";
import { closeOpenDialogs } from "./idle-reset";

// The kitchen screen's full-screen reminder (ADR 0005 §4, issue #66). The
// shell renders it with the reminders at render time; away from the home
// page it asks again every minute while awake, and at once when the screen
// wakes, so a reminder posted from a phone or by Baumy arrives on its own.
// It shows the oldest reminder over everything; each face's "I've seen it"
// records it as that member, without changing who is picked on the kiosk;
// "Dismiss for everyone" asks who first. Once everyone has seen
// it, the last "Seen" shows for a moment, then the next reminder (or the
// page) comes back.

/** How long a reminder everyone has now seen stays, to show the last tick. */
export const SEEN_LINGER_MS = 700;

type Faced = { memberId: string; reminderId: string };

function faceForm({ memberId, reminderId }: Faced): FormData {
  const form = new FormData();
  form.set("memberId", memberId);
  form.set("reminderId", reminderId);
  form.set("requestId", newRequestId());
  return form;
}

export function KioskReminders({
  initial,
}: {
  /** list_reminders at render time; null if it could not be read. */
  initial: ListRemindersData | null;
}) {
  const [data, setData] = useState(initial);
  // A new render of the shell (an avatar tap, the home page's
  // refresh) brings fresher reminders: take them.
  const [fromServer, setFromServer] = useState(initial);
  if (initial !== fromServer) {
    setFromServer(initial);
    setData(initial);
  }
  const [lingering, setLingering] = useState<{
    reminder: ReminderView;
    data: ListRemindersData;
  } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const linger = useRef<number | undefined>(undefined);

  const poll = useCallback(async () => {
    try {
      const result = await kioskRemindersAction();
      if (result.ok) setData(result.data);
    } catch {
      // Offline for a moment: the next poll tries again.
    }
  }, []);

  // Only reads it needs: the home page's own 60-second refresh renders the
  // shell again (and so brings the reminders), and a sleeping screen shows
  // nothing, so the timer asks only away from home and while awake. Waking
  // (a tap on the screensaver, the iPad's screen coming on) asks at once.
  const pathname = usePathname();
  const onHome = pathname === "/kiosk";
  const asleep = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!onHome && !asleep.current) void poll();
    }, REMINDER_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const onNight = (e: Event) => {
      asleep.current = (e as CustomEvent<NightEventDetail>).detail.asleep;
      if (!asleep.current) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NIGHT_EVENT, onNight);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NIGHT_EVENT, onNight);
    };
  }, [poll, onHome]);
  useEffect(() => () => window.clearTimeout(linger.current), []);

  const current = lingering?.reminder ?? data?.reminders[0] ?? null;
  const shownData = lingering?.data ?? data;
  // A reminder coming up closes whatever was open (a PIN pad, a sheet), as
  // the screensaver does: nothing waits half-done under it.
  const currentId = current?.id;
  useEffect(() => {
    if (currentId) closeOpenDialogs(document);
  }, [currentId]);
  if (!current || !shownData) return null;

  const seen = async (memberId: string) => {
    setBusy(true);
    setMessage(undefined);
    const result = await kioskSeenReminderAction(
      faceForm({ memberId, reminderId: current.id }),
    ).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setMessage(result?.message ?? "That did not go through. Try again.");
      void poll();
      return;
    }
    const next = markSeen(shownData, current.id, memberId);
    if (result.data.seenByEveryone) {
      // Everyone has: show the last tick, then let it go for good.
      setLingering({
        reminder: next.reminders.find((r) => r.id === current.id)!,
        data: next,
      });
      setData(withoutReminder(next, current.id));
      window.clearTimeout(linger.current);
      linger.current = window.setTimeout(
        () => setLingering(null),
        SEEN_LINGER_MS,
      );
    } else {
      setData(next);
    }
  };

  const dismissAs = async (memberId: string) => {
    setBusy(true);
    setMessage(undefined);
    const result = await kioskDismissReminderAction(
      faceForm({ memberId, reminderId: current.id }),
    ).catch(() => null);
    setBusy(false);
    setChoosing(false);
    if (!result?.ok) {
      setMessage(result?.message ?? "That did not go through. Try again.");
      void poll();
      return;
    }
    setData(withoutReminder(shownData, current.id));
  };

  return (
    <ReminderScreen
      key={current.id}
      title={current.title}
      body={current.body}
      from={current.createdBy.name}
      faces={reminderFaces(shownData, current)}
      onSeen={(id) => void seen(id)}
      onDismiss={() => {
        setMessage(undefined);
        setChoosing(true);
      }}
      choosingDismisser={choosing}
      onDismissAs={(id) => void dismissAs(id)}
      onCancelDismiss={() => setChoosing(false)}
      busy={busy || lingering !== null}
      message={message}
    />
  );
}
