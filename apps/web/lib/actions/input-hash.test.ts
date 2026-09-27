import { describe, expect, it } from "vitest";
import { inputHash, stableStringify } from "./input-hash";

describe("stableStringify", () => {
  it("sorts keys at every level and keeps arrays in order", () => {
    expect(stableStringify({ b: 1, a: { d: [3, 1], c: 2 } })).toBe(
      '{"a":{"c":2,"d":[3,1]},"b":1}',
    );
  });

  it("drops undefined fields and writes dates as ISO strings", () => {
    expect(
      stableStringify({ a: undefined, at: new Date("2026-01-01T00:00:00Z") }),
    ).toBe('{"at":"2026-01-01T00:00:00.000Z"}');
  });
});

describe("inputHash", () => {
  it("is the same for the same input in any key order", () => {
    expect(inputHash("x", { a: 1, b: 2 })).toBe(inputHash("x", { b: 2, a: 1 }));
    expect(inputHash("x", { a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs by input and by action", () => {
    expect(inputHash("x", { a: 1 })).not.toBe(inputHash("x", { a: 2 }));
    expect(inputHash("x", { a: 1 })).not.toBe(inputHash("y", { a: 1 }));
    expect(inputHash("x", undefined)).toBe(inputHash("x", null));
  });
});
