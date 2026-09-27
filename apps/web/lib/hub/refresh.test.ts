// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// The kiosk's re-read skips the shopping cache, and only the kiosk's.

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "baumy_refresh" && jar.value !== undefined
        ? { name, value: jar.value }
        : undefined,
  }),
}));

const { cachedBrain, forgetShoppingReads } =
  await import("@/lib/integrations/brain");
const { REFRESH_COOKIE, refreshCookieLine } = await import("./refresh");
const { skipShoppingCacheOnRefresh } = await import("./refresh-server");

afterEach(() => {
  jar.value = undefined;
  forgetShoppingReads();
});

function counting() {
  let reads = 0;
  const client = cachedBrain(
    {
      listShopping: async () => {
        reads += 1;
        return { ok: true, data: [] };
      },
      addShopping: async () => ({ ok: false, reason: "unavailable" }),
      checkOffShopping: async () => ({ ok: false, reason: "unavailable" }),
    },
    () => 0,
  );
  return { client, reads: () => reads };
}

describe("skipShoppingCacheOnRefresh", () => {
  it("forgets the cached list on the kiosk's re-read", async () => {
    const { client, reads } = counting();
    await client.listShopping();
    jar.value = "1";
    expect(await skipShoppingCacheOnRefresh()).toBe(true);
    await client.listShopping();
    expect(reads()).toBe(2);
  });

  it("keeps it for any other page load", async () => {
    const { client, reads } = counting();
    await client.listShopping();
    expect(await skipShoppingCacheOnRefresh()).toBe(false);
    jar.value = "0";
    expect(await skipShoppingCacheOnRefresh()).toBe(false);
    await client.listShopping();
    expect(reads()).toBe(1);
  });

  it("marks the request with a short-lived, same-site cookie", () => {
    expect(refreshCookieLine()).toBe(
      `${REFRESH_COOKIE}=1; path=/; max-age=10; samesite=strict`,
    );
  });
});
