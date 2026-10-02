"use client";

import { createContext, useContext, type ReactNode } from "react";

// The kiosk's acting member, and whether they have a personal PIN (issue
// #145), for every kiosk form that may need it: the kiosk shell provides it
// (app/kiosk/(shell)/layout.tsx), so a form never opens a PinPad for someone
// who has no PIN. Off the kiosk there is no provider, and a session never
// asks for a PIN anyway.

export interface ActingPin {
  /** The acting member's name, for "Charl hasn't set a personal PIN yet". */
  name?: string;
  hasPin: boolean;
}

const ActingPinContext = createContext<ActingPin>({ hasPin: true });

export function ActingPinProvider({
  value,
  children,
}: {
  value: ActingPin;
  children: ReactNode;
}) {
  return (
    <ActingPinContext.Provider value={value}>
      {children}
    </ActingPinContext.Provider>
  );
}

export function useActingPin(): ActingPin {
  return useContext(ActingPinContext);
}
