// The e2e inbox. scripts/e2e-local.sh gives the server AUTH_EMAIL_CAPTURE_FILE,
// and @baumy/auth's sendAuthEmail appends one JSON line per auth email to it
// instead of sending anything. Ported from camp-404
// `apps/web/tests/e2e-db/_mail.ts`. The server honours the file only with
// E2E_TEST_MODE=1 and off Vercel (resolveAuthEmailCaptureFile).

import { readFile } from "node:fs/promises";

type AuthMailKind =
  | "reset"
  | "verify"
  | "password-reset-completed"
  | "password-set"
  | "passkey-added";

interface CapturedMail {
  at: string;
  to: string;
  kind: AuthMailKind;
  url: string | null;
}

/** The capture file, which the harness exports to both server and specs. */
export function captureFile(): string {
  const file = process.env.AUTH_EMAIL_CAPTURE_FILE?.trim();
  if (!file) {
    throw new Error(
      "AUTH_EMAIL_CAPTURE_FILE is not set. Run the suite through scripts/e2e-local.sh.",
    );
  }
  return file;
}

export async function readMail(): Promise<CapturedMail[]> {
  let raw: string;
  try {
    raw = await readFile(captureFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CapturedMail);
}

/**
 * Wait up to 15 s for an auth email of `kind` to `to` and return its link.
 * The file outlives a run, so every spec uses a fresh address.
 */
export async function waitForAuthMail(
  to: string,
  kind: AuthMailKind,
): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const match = (await readMail())
      .filter((m) => m.to === to && m.kind === kind && m.url)
      .at(-1);
    if (match?.url) return match.url;
    if (Date.now() > deadline) {
      throw new Error(`No "${kind}" email to ${to} in ${captureFile()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Wait up to 15 s for an auth email of `kind` to `to` that carries no link
 * (a notice, such as "passkey-added").
 */
export async function waitForNotice(
  to: string,
  kind: AuthMailKind,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if ((await readMail()).some((m) => m.to === to && m.kind === kind)) return;
    if (Date.now() > deadline) {
      throw new Error(`No "${kind}" email to ${to} in ${captureFile()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
