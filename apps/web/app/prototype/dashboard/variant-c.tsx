"use client";

// PROTOTYPE (issue #7), throwaway. Variant C ("Busy"): a warm retro-OS
// arcade HUD. Menubar + ticker, a status desktop of bounty icons, a big
// calendar window, side widgets and a taskbar with Baumy as the Start button.

import { useCallback, useEffect, useRef, useState } from "react";
import { C, VC_CSS } from "./variant-c-chrome";
import {
  BoardWin,
  CalendarWin,
  FairyLights,
  Leaderboard,
  MenuBar,
  PotWin,
  SparkWin,
  StatusDesktop,
  Taskbar,
  Ticker,
  type Filter,
} from "./variant-c-home";
import { BountyPopup, Listening, Reminder, Screensaver } from "./variant-c-overlays";

// A fixed "now" for the mockup (Mon 28 Sep 2026, 17:42), ticking from mount.
const START = new Date(2026, 8, 28, 17, 42, 5).getTime();
const IDLE_MS = 60_000;

export function VariantC() {
  const [now, setNow] = useState(() => new Date(START));
  const [popup, setPopup] = useState<Filter | null>(null);
  const [listening, setListening] = useState(false);
  const [reminder, setReminder] = useState(false);
  const [saver, setSaver] = useState(false);
  const idle = useRef<number | undefined>(undefined);

  useEffect(() => {
    const t0 = Date.now();
    const t = window.setInterval(() => setNow(new Date(START + Date.now() - t0)), 1000);
    return () => window.clearInterval(t);
  }, []);

  const poke = useCallback(() => {
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setSaver(true), IDLE_MS);
  }, []);

  useEffect(() => {
    const onReminder = () => {
      setSaver(false);
      setReminder(true);
    };
    const onSaver = () => setSaver(true);
    window.addEventListener("proto:reminder", onReminder);
    window.addEventListener("proto:screensaver", onSaver);
    window.addEventListener("pointerdown", poke);
    window.addEventListener("keydown", poke);
    poke();
    return () => {
      window.removeEventListener("proto:reminder", onReminder);
      window.removeEventListener("proto:screensaver", onSaver);
      window.removeEventListener("pointerdown", poke);
      window.removeEventListener("keydown", poke);
      window.clearTimeout(idle.current);
    };
  }, [poke]);

  return (
    <div
      className="relative h-[1180px] w-[820px] select-none overflow-hidden"
      style={{
        background: C.desk,
        backgroundImage: `radial-gradient(${C.chrome} 1px, transparent 1px), radial-gradient(ellipse at 50% 0%, #4a102755 0%, transparent 60%)`,
        backgroundSize: "8px 8px, 100% 100%",
        color: C.text,
      }}
    >
      <style>{VC_CSS}</style>
      <MenuBar now={now} />
      <Ticker />
      <FairyLights />
      <StatusDesktop onOpen={setPopup} />
      <div className="absolute left-3 right-3 top-[358px] bottom-[92px] flex gap-[10px]">
        <div className="w-[536px] shrink-0">
          <CalendarWin now={now} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
          <Leaderboard />
          <PotWin />
          <SparkWin />
          <BoardWin />
        </div>
      </div>
      <Taskbar now={now} listening={listening} onVoice={() => setListening((l) => !l)} onTab={() => setPopup({ status: "all", tax: "all" })} />
      {listening && <Listening onStop={() => setListening(false)} />}
      {popup && <BountyPopup initial={popup} onClose={() => setPopup(null)} />}
      {reminder && <Reminder onClose={() => setReminder(false)} />}
      {saver && <Screensaver now={now} onWake={() => setSaver(false)} />}
    </div>
  );
}
