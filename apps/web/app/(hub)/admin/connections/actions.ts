"use server";

import { revalidatePath } from "next/cache";
import { actionForm } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { ActionOutput } from "@/lib/actions/registry";

// /admin/connections' server actions (issue #104): thin wrappers around the
// registry. The actions themselves refuse anyone but an admin's live session.

const PAGE = "/admin/connections";

type Result<N extends Parameters<typeof actionForm>[0]> = ActionResult<
  ActionOutput<N>
>;

export async function createServiceTokenAction(
  _prev: Result<"create_service_token"> | null,
  form: FormData,
): Promise<Result<"create_service_token">> {
  const result = await actionForm("create_service_token", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function rotateServiceTokenAction(
  _prev: Result<"rotate_service_token"> | null,
  form: FormData,
): Promise<Result<"rotate_service_token">> {
  const result = await actionForm("rotate_service_token", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function revokeServiceTokenAction(
  _prev: Result<"revoke_service_token"> | null,
  form: FormData,
): Promise<Result<"revoke_service_token">> {
  const result = await actionForm("revoke_service_token", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}
