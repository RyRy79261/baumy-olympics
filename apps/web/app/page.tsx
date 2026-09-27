import Link from "next/link";
import { getActor } from "@/lib/auth";

// Reads the session, so it renders per request.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const actor = await getActor();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">Baumy</h1>
      {/* Unstyled until the pixel UI kit lands (issue #7). */}
      {actor?.kind === "member" ? (
        <p>
          Signed in as <span data-testid="signed-in-as">{actor.email}</span>.{" "}
          <Link href="/auth/sign-out">Sign out</Link>
        </p>
      ) : (
        <p>
          <Link href="/auth/sign-in">Sign in</Link>
        </p>
      )}
    </main>
  );
}
