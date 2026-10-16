"use server";

import { actionFormRefreshing } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { RevokeMcpConnectionData } from "@/lib/actions/mcp-connections";

// /settings/connections' server action: a thin wrapper around the registry.

export async function revokeMcpConnectionAction(
  _prev: ActionResult<RevokeMcpConnectionData> | null,
  form: FormData,
): Promise<ActionResult<RevokeMcpConnectionData>> {
  return actionFormRefreshing("revoke_mcp_connection", form);
}
