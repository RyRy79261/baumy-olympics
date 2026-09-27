import { createHash } from "node:crypto";

// The idempotency fingerprint stored in `action_requests.input_hash`: the
// action name and the PARSED input, as JSON with sorted keys, so the same
// logical input hashes the same however its keys were ordered or defaulted.

/** JSON with object keys sorted at every level. `undefined` fields drop out. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .map((k) => [k, obj[k]]),
      );
    }
    return v;
  });
}

export function inputHash(action: string, input: unknown): string {
  return createHash("sha256")
    .update(stableStringify({ action, input: input ?? null }))
    .digest("hex");
}
