import { isIP } from "node:net";

// Where a pairing request came from, coarsely (issue #126, PR #130 review).
// A pairing link can be phished: someone starts a request on their own
// laptop and sends an admin the approve link. The confirm page therefore says
// how long ago the code was asked for, and warns when the admin's network is
// not the one the request came from.
//
// Only the network prefix is kept, never the full address: /24 for IPv4 and
// /48 for IPv6, which is about one home connection. A household's phone and
// iPad on the same Wi-Fi share it; a phone on mobile data will not, so the
// warning says "only approve it if you're standing at the iPad", not "no".

/** The /24 (IPv4) or /48 (IPv6) network an address is in, or null. */
export function networkPrefix(ip: string | null | undefined): string | null {
  const raw = (ip ?? "").trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw)?.[1];
  const address = mapped ?? raw;
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b, c] = address.split(".");
    return `${a}.${b}.${c}.0/24`;
  }
  if (kind === 6) {
    const [head = "", tail = ""] = address.toLowerCase().split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = address.includes("::")
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
    const first = groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, ""));
    return `${first.join(":")}::/48`;
  }
  return null;
}

/** "just now", "1 minute ago", "7 minutes ago". */
export function askedAgo(createdAt: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - createdAt.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

export const DIFFERENT_NETWORK_WARNING =
  "This code was asked for from a different network than yours. Only approve it if you're standing at the iPad.";

/**
 * Whether to warn the admin: the request's network and theirs differ, or
 * either is unknown (then nothing says they are the same).
 */
export function differentNetwork(
  requested: string | null,
  current: string | null,
): boolean {
  return requested === null || current === null || requested !== current;
}
