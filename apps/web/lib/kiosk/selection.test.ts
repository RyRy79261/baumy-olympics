// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { useTestDb } from "@baumy/db/test-harness";
import { FIXED_NOW, seedMember } from "@/test-utils/actions";
import type { KioskActor } from "@/lib/auth";
import { pickKioskMember } from "./selection";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const kiosk: KioskActor = { kind: "kiosk", deviceId: "d1" };

describe("pickKioskMember", () => {
  it("picks an active member of the household", async () => {
    const me = await seedMember(db(), { displayName: "Ryan" });
    await expect(pickKioskMember(kiosk, me)).resolves.toEqual({
      ok: true,
      data: { memberId: me, displayName: "Ryan" },
    });
  });

  it("refuses an unpaired kiosk, a non-id and someone gone", async () => {
    const me = await seedMember(db());
    await expect(pickKioskMember(null, me)).resolves.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    for (const bad of [undefined, 42, "nope"]) {
      await expect(pickKioskMember(kiosk, bad)).resolves.toMatchObject({
        code: "INVALID_INPUT",
      });
    }
    const gone = await seedMember(db(), { deactivatedAt: FIXED_NOW });
    await expect(pickKioskMember(kiosk, gone)).resolves.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
