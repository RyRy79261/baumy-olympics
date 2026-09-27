import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Whether an `Authorization` header is exactly `Bearer <secret>`, compared in
 * constant time (both sides are hashed first, so their lengths never leak).
 */
export function bearerMatches(header: string | null, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}
