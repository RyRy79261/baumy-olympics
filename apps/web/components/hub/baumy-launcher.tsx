"use client";

import { useState } from "react";
import { BaumyButton, Button, Dialog, Sprite } from "@baumy/ui";

// The Baumy button (SPEC §3.1, §3.6), bottom right on the hub and the
// kitchen screen. PLACEHOLDER: the command sheet it opens (type or talk to
// Baumy) arrives with the AI command (issues #21 and #22); until then it
// says so.

export function BaumyLauncher({ kiosk = false }: { kiosk?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <BaumyButton
        state={open ? "listen" : "idle"}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={() => setOpen(false)} title="Baumy">
        <div className="flex flex-col items-center gap-4 text-center">
          <Sprite name="baumy" state="sleep" size={4} color="#171717" />
          <p className="text-sm">
            Baumy is still asleep. Soon you can ask here to log a chore, add an
            event or pin a note.
          </p>
          <Button
            size={kiosk ? "kiosk" : "default"}
            onClick={() => setOpen(false)}
          >
            OK
          </Button>
        </div>
      </Dialog>
    </>
  );
}
