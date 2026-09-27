import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth";

const getActor = vi.fn<() => Promise<Actor | null>>();
vi.mock("@/lib/auth", () => ({ getActor: () => getActor() }));

const { GET } = await import("./route");

beforeEach(() => getActor.mockReset());

describe("GET /api/me", () => {
  it("returns the actor, never cached", async () => {
    const actor: Actor = {
      kind: "member",
      userId: "u_1",
      email: "ryan@example.com",
      name: "Ryan",
      emailVerified: true,
      sessionCreatedAt: "2026-09-27T09:00:00.000Z",
    };
    getActor.mockResolvedValue(actor);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ actor });
  });

  it("answers 401 when nobody is signed in", async () => {
    getActor.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in." });
  });
});
