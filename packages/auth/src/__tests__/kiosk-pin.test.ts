import { describe, expect, it } from "vitest";
import { hashKioskPin, verifyKioskPin } from "../kiosk-pin";

describe("kiosk PIN hashing", () => {
  it("hashes with a fresh salt and verifies only the right PIN", async () => {
    const a = await hashKioskPin("4321");
    const b = await hashKioskPin("4321");
    expect(a).toMatch(
      /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/,
    );
    expect(a).not.toBe(b);
    expect(a).not.toContain("4321");
    await expect(verifyKioskPin("4321", a)).resolves.toBe(true);
    await expect(verifyKioskPin("4321", b)).resolves.toBe(true);
    await expect(verifyKioskPin("1234", a)).resolves.toBe(false);
    await expect(verifyKioskPin("43210", a)).resolves.toBe(false);
  });

  it("never matches a malformed stored value", async () => {
    const good = await hashKioskPin("123456");
    const parts = good.split("$");
    const bad = [
      "",
      "4321",
      good.replace("scrypt", "bcrypt"),
      parts.slice(0, 5).join("$"),
      [...parts.slice(0, 4), "", parts[5]].join("$"),
      [...parts.slice(0, 5), ""].join("$"),
      ["scrypt", "x", 8, 1, parts[4], parts[5]].join("$"),
      ["scrypt", 0, 8, 1, parts[4], parts[5]].join("$"),
      // N not a power of two: scrypt itself refuses.
      ["scrypt", 1000, 8, 1, parts[4], parts[5]].join("$"),
    ];
    for (const stored of bad) {
      await expect(verifyKioskPin("123456", stored)).resolves.toBe(false);
    }
  });
});
