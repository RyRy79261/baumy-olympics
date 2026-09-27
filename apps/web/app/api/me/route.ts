import { getActor } from "@/lib/auth";

// Who am I? The smallest authenticated endpoint: a cookie session or an
// `Authorization: Bearer <token>` from sign-in resolves to the same actor.
// Never cached, since the answer is per caller.

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const actor = await getActor();
  if (!actor) {
    return Response.json(
      { error: "Not signed in." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json(
    { actor },
    { headers: { "cache-control": "private, no-store" } },
  );
}
