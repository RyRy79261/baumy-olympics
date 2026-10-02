// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@baumy/db/kiosk-pin", () => ({ findKioskPinState: vi.fn() }));

const { actingMemberHasPin } = await import("./acting-pin");

// Issue #145: one boolean for the member picked on the kiosk, never the
// hash or the lock.

describe("actingMemberHasPin", () => {
  it("is true only for an active member with a PIN hash", async () => {
    const find = vi.fn(async (_h: string, id: string) =>
      id === "with"
        ? { pinHash: "hash", lockedAt: null }
        : id === "without"
          ? { pinHash: null, lockedAt: null }
          : null,
    );
    await expect(actingMemberHasPin("h1", "with", find)).resolves.toBe(true);
    await expect(actingMemberHasPin("h1", "without", find)).resolves.toBe(
      false,
    );
    await expect(actingMemberHasPin("h1", "gone", find)).resolves.toBe(false);
    expect(find).toHaveBeenCalledWith("h1", "with");
  });

  it("asks nothing when nobody is picked", async () => {
    const find = vi.fn();
    await expect(actingMemberHasPin("h1", undefined, find)).resolves.toBe(
      false,
    );
    expect(find).not.toHaveBeenCalled();
  });
});
