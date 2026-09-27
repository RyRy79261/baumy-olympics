"use client";

import { Button } from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import type { RevokeMcpConnectionData } from "@/lib/actions/mcp-connections";
import { toast } from "@/lib/ui/toast";
import { revokeMcpConnectionAction } from "./actions";

/**
 * revoke_mcp_connection: one tap, reported through a toast. The toast is
 * raised as the answer arrives, not from an effect: a disconnected app's
 * card leaves the page with that same answer, taking this form with it.
 */
export function DisconnectForm({
  grantId,
  clientName,
}: {
  grantId: string;
  clientName: string;
}) {
  const { formAction, pending, requestId } =
    useActionForm<RevokeMcpConnectionData>(async (prev, form) => {
      const result = await revokeMcpConnectionAction(prev, form);
      if (result.ok)
        toast.success(`${result.data.clientName} is disconnected.`);
      else toast.error(result.message);
      return result;
    });
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
