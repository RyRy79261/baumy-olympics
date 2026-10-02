"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportKind } from "@baumy/types";
import { Button } from "@baumy/ui";
import {
  installClientErrorCapture,
  onClientError,
} from "@/lib/feedback/client-errors";
import {
  NO_OFFER_YET,
  OFFER_VISIBLE_MS,
  offered,
  shouldOffer,
  snoozed,
  type OfferState,
} from "@/lib/feedback/offer";
import { kioskReportBugAction, reportBugAction } from "@/components/feedback/actions";
import { ReportBugDialog } from "./report-bug-dialog";
import {
  REPORT_PROBLEM_EVENT,
  type ReportProblemRequest,
} from "./report-problem";
import {
  motionPermissionNeeded,
  rememberMotionAnswer,
  rememberedMotionAnswer,
  requestMotionPermission,
  useShakeGesture,
} from "./use-shake-gesture";

// The reporter's one mount per shell (issue #133), after camp-404
// `apps/web/app/feedback-gate.tsx`. The hub layout mounts it for a signed-in
// member, the kiosk shell for the paired kitchen screen. It:
//
//   - keeps the recent errors from the first render, so a report can
//     attach what happened before it;
//   - opens the reporter on a shake, and on openReportProblem() (the
//     Settings card, an error page's Report button);
//   - asks iOS for motion events on the first tap, since the iPad only
//     sends them after a yes given from a tap; a "no" is remembered and not
//     asked again on its own (the Settings card can ask);
//   - offers "Report this bug" when an uncaught error happens: optional,
//     dismissible, never blocking, and rate-limited (lib/feedback/offer.ts)
//     so an error loop cannot keep putting it up.

const OFFER_STATE_KEY = "baumy:report-offer";

function readOfferState(): OfferState {
  try {
    const raw = window.sessionStorage.getItem(OFFER_STATE_KEY);
    return raw
      ? { ...NO_OFFER_YET, ...(JSON.parse(raw) as OfferState) }
      : NO_OFFER_YET;
  } catch {
    return NO_OFFER_YET;
  }
}

function writeOfferState(state: OfferState): void {
  try {
    window.sessionStorage.setItem(OFFER_STATE_KEY, JSON.stringify(state));
  } catch {
    // Private mode: the limit then lasts as long as the page.
  }
}

export function FeedbackGate({
  surface,
  aiAvailable,
  blocked = null,
}: {
  surface: "ui" | "kiosk";
  aiAvailable: boolean;
  /** Why nobody can send from here yet (the kiosk with nobody picked). */
  blocked?: string | null;
}) {
  const kiosk = surface === "kiosk";
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const [kind, setKind] = useState<ReportKind>("bug");
  const [offer, setOffer] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    busy.current = open || offer;
  }, [open, offer]);

  const openReporter = useCallback((request: ReportProblemRequest = {}) => {
    setPrefill(request.description ?? "");
    setKind(request.kind ?? "bug");
    setOffer(false);
    setOpen(true);
  }, []);

  useEffect(() => installClientErrorCapture(), []);

  useShakeGesture({ enabled: !open, onShake: () => openReporter() });

  useEffect(() => {
    const onRequest = (event: Event) =>
      openReporter((event as CustomEvent<ReportProblemRequest>).detail);
    window.addEventListener(REPORT_PROBLEM_EVENT, onRequest);
    return () => window.removeEventListener(REPORT_PROBLEM_EVENT, onRequest);
  }, [openReporter]);

  // iOS: ask on the first tap (a click is a user gesture iOS accepts; a
  // touch pointerdown is not).
  useEffect(() => {
    if (!motionPermissionNeeded() || rememberedMotionAnswer() === "denied") {
      return;
    }
    const onFirstTap = () => {
      void requestMotionPermission().then(rememberMotionAnswer);
    };
    window.addEventListener("click", onFirstTap, { once: true });
    return () => window.removeEventListener("click", onFirstTap);
  }, []);

  // The optional offer when something breaks.
  useEffect(
    () =>
      onClientError((error) => {
        const state = readOfferState();
        const now = Date.now();
        if (!shouldOffer(error, state, now, busy.current)) return;
        writeOfferState(offered(state, now));
        setOffer(true);
      }),
    [],
  );
  useEffect(() => {
    if (!offer) return;
    const timer = setTimeout(() => setOffer(false), OFFER_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [offer]);

  const size = kiosk ? "kiosk" : "default";

  return (
    <>
      {offer ? (
        <div
          role="status"
          data-testid="report-offer"
          className={
            "pixel-frame pixel-frame-4 fixed inset-x-0 z-[75] mx-auto flex w-fit max-w-[min(92vw,36rem)] flex-wrap items-center gap-3 bg-bm-raised px-4 py-2 text-lg text-bm-text " +
            (kiosk ? "top-24" : "bottom-4 max-sm:bottom-36")
          }
        >
          <span>Something went wrong on this page.</span>
          <Button size={size} onClick={() => openReporter()}>
            Report this bug
          </Button>
          <Button
            size={size}
            variant="ghost"
            onClick={() => {
              writeOfferState(snoozed(readOfferState(), Date.now()));
              setOffer(false);
            }}
          >
            Not now
          </Button>
        </div>
      ) : null}
      <ReportBugDialog
        open={open}
        onClose={() => setOpen(false)}
        send={kiosk ? kioskReportBugAction : reportBugAction}
        defaultKind={kind}
        defaultDescription={prefill}
        aiAvailable={aiAvailable}
        kiosk={kiosk}
        blocked={blocked}
      />
    </>
  );
}
