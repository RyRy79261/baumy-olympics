"use server";

import { revalidatePath } from "next/cache";
import { actionForm } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { RevokeMcpConnectionData } from "@/lib/actions/mcp-connections";

// /settings/connections' server action: a thin wrapper around the registry.

export async function revokeMcpConnectionAction(
  _prev: ActionResult<RevokeMcpConnectionData> | null,
  form: FormData,
): Promise<ActionResult<RevokeMcpConnectionData>> {
  const result = await actionForm("revoke_mcp_connection", form);
  if (result.ok) revalidatePath("/settings/connections");
  return result;
}
