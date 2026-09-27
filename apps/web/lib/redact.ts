// Secrets never reach a log line (AGENTS.md "Integrations", SPEC §9). Pure:
// the caller passes the env it runs with, so a test can pass a small one.
// After camp-404 `packages/core/src/text-redaction.ts`.

type Env = Readonly<Record<string, string | undefined>>;

/** The value of every env var that looks like a secret, longest first. */
function secretValues(env: Env): string[] {
  return Object.entries(env)
    .filter(
      ([k, v]) =>
        v !== undefined &&
        v.length >= 8 &&
        /SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL/.test(k),
    )
    .map(([, v]) => v as string)
    .sort((a, b) => b.length - a.length);
}

/** `text` with every secret-looking env value replaced. */
export function redactSecrets(text: string, env: Env = process.env): string {
  let out = text;
  for (const v of secretValues(env)) out = out.split(v).join("[redacted]");
  return out;
}
