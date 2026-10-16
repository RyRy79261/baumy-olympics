"use server";

import { actionFormRefreshing } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { ActionOutput } from "@/lib/actions/registry";

// /admin/connections' server actions (issue #104): thin wrappers around the
// registry. The actions themselves refuse anyone but an admin's live session.

type Result<N extends Parameters<typeof actionFormRefreshing>[0]> =
  ActionResult<ActionOutput<N>>;

export async function createServiceTokenAction(
  _prev: Result<"create_service_token"> | null,
  form: FormData,
): Promise<Result<"create_service_token">> {
  return actionFormRefreshing("create_service_token", form);
}

export async function rotateServiceTokenAction(
  _prev: Result<"rotate_service_token"> | null,
  form: FormData,
): Promise<Result<"rotate_service_token">> {
  return actionFormRefreshing("rotate_service_token", form);
}

export async function revokeServiceTokenAction(
  _prev: Result<"revoke_service_token"> | null,
  form: FormData,
): Promise<Result<"revoke_service_token">> {
  return actionFormRefreshing("revoke_service_token", form);
}
