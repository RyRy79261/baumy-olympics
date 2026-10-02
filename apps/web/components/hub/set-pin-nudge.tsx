import Link from "next/link";
import { Card } from "@baumy/ui";

// The nudge after joining (issue #145): a member who has no personal PIN
// yet sees, on the hub home, what it is for and where to set it, until they
// do. Nobody is asked for a PIN at the kitchen screen without having heard
// of it first (Felix's case: the cat asked for a PIN he never set).

export function SetPinNudge() {
  return (
    <Card
      title="Set your personal PIN"
      description="The kitchen screen asks for it only before it disputes a chore as you. It is yours alone, and it is not for pairing the iPad."
      data-testid="set-pin-nudge"
    >
      <Link href="/settings#pin" className="text-sm underline">
        Set it now
      </Link>
    </Card>
  );
}
