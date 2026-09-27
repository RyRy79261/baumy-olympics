"use client";

import { useEffect } from "react";
import { Button } from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { toast } from "@/lib/ui/toast";
import { revokeMcpConnectionAction } from "./actions";

/** revoke_mcp_connection: one tap, reported through a toast. */
export function DisconnectForm({
  grantId,
  clientName,
}: {
  grantId: string;
  clientName: string;
}) {
  const { state, formAction, pending, requestId } = useActionForm(
    revokeMcpConnectionAction,
  );
  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(`${state.data.clientName} is disconnected.`);
    else toast.error(state.message);
  }, [state]);
  return (
    <form action={formAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="grantId" value={grantId} />
      <Button
        type="submit"
        variant="danger"
        disabled={pending}
        aria-label={`Disconnect ${clientName}`}
      >
        {pending ? "Disconnecting..." : "Disconnect"}
      </Button>
    </form>
  );
}
