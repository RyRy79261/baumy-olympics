// @vitest-environment node
import { describe, expect, it } from "vitest";
import { askedAgo, differentNetwork, networkPrefix } from "./network";

describe("networkPrefix", () => {
  it("keeps only the /24 of an IPv4 address", () => {
    expect(networkPrefix("203.0.113.57")).toBe("203.0.113.0/24");
    expect(networkPrefix(" 10.1.2.3 ")).toBe("10.1.2.0/24");
    expect(networkPrefix("::ffff:192.0.2.9")).toBe("192.0.2.0/24");
  });

  it("keeps only the /48 of an IPv6 address, however it is written", () => {
    expect(networkPrefix("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1::/48");
    expect(networkPrefix("2001:0DB8:0001::7")).toBe("2001:db8:1::/48");
    expect(networkPrefix("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(networkPrefix("::1")).toBe("0:0:0::/48");
  });

  it("is null for anything that is not an address", () => {
    for (const bad of ["unknown", "", null, undefined, "1.2.3", "a.b.c.d"]) {
      expect(networkPrefix(bad)).toBeNull();
    }
  });
});

describe("askedAgo", () => {
  const at = new Date("2026-10-01T10:00:00Z");
  const after = (ms: number) => new Date(at.getTime() + ms);
  it("says how long ago, in whole minutes", () => {
    expect(askedAgo(at, after(59_999))).toBe("just now");
    expect(askedAgo(at, after(60_000))).toBe("1 minute ago");
    expect(askedAgo(at, after(7 * 60_000 + 5_000))).toBe("7 minutes ago");
  });
});

describe("differentNetwork", () => {
  it("warns unless both networks are known and the same", () => {
    expect(differentNetwork("203.0.113.0/24", "203.0.113.0/24")).toBe(false);
    expect(differentNetwork("203.0.113.0/24", "198.51.100.0/24")).toBe(true);
    expect(differentNetwork(null, "203.0.113.0/24")).toBe(true);
    expect(differentNetwork("203.0.113.0/24", null)).toBe(true);
  });
});
