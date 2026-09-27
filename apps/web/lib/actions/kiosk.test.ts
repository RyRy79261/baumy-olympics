// @vitest-environment node
import { redirect } from "next/navigation";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { useTestDb } from "@baumy/db/test-harness";
import { seedMember } from "@/test-utils/actions";
import type { KioskActor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";

// The kiosk adapter: the paired device and the picked member become the
// actor, the surface is `kiosk`, and the PinPad's field becomes `ctx.pin` for
// this one request, never part of the input.

const getKioskActor = vi.fn<() => Promise<KioskActor | null>>();
vi.mock("@/lib/auth", () => ({ getKioskActor: () => getKioskActor() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "7.7.7.7" }),
}));

const { kioskActionForm, kioskRequestCtx, NOT_PAIRED_MESSAGE } =
  await import("./kiosk");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const PIN = "4321";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});

beforeEach(() => {
  getKioskActor.mockReset();
  __resetMemoryRateLimits();
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

describe("kioskRequestCtx", () => {
  it("builds the kiosk context, with the PIN only when one was sent", async () => {
    getKioskActor.mockResolvedValue({ kind: "kiosk", deviceId: "d1" });
    const ctx = await kioskRequestCtx("req-12345678", "1234");
    expect(ctx).toMatchObject({
      actor: { kind: "kiosk", deviceId: "d1" },
      source: "kiosk",
      householdId: HOUSEHOLD_ID,
      requestId: "req-12345678",
      pin: "1234",
      ip: "7.7.7.7",
    });
    expect(await kioskRequestCtx(undefined, undefined)).not.toHaveProperty(
      "pin",
    );
  });

  it("is null on a kiosk that is not paired", async () => {
    getKioskActor.mockResolvedValue(null);
    await expect(kioskRequestCtx(undefined, "1234")).resolves.toBeNull();
  });
});

describe("kioskActionForm", () => {
  it("attests with the form's PIN, which never reaches the input", async () => {
    const me = await seedMember(db(), { kioskPinHash: pinHash });
    getKioskActor.mockResolvedValue({
      kind: "kiosk",
      deviceId: "d1",
      memberId: me,
      displayName: "Ryan",
    });
    // check_kiosk_pin takes a strict empty input: a leaked `pin` field
    // would be INVALID_INPUT.
    await expect(
      kioskActionForm("check_kiosk_pin", form({ pin: PIN })),
    ).resolves.toEqual({
      ok: true,
      data: { memberId: me, displayName: "Ryan" },
    });
    await expect(
      kioskActionForm("check_kiosk_pin", form({ pin: "" })),
    ).resolves.toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
  });

  it("runs on the kiosk surface, where admin actions are refused", async () => {
    const admin = await seedMember(db(), { role: "admin" });
    getKioskActor.mockResolvedValue({
      kind: "kiosk",
      deviceId: "d1",
      memberId: admin,
    });
    await expect(
      kioskActionForm(
        "pair_kiosk",
        form({ name: "x", requestId: "req-12345678" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
  });

  it("says so when the kiosk is not paired", async () => {
    getKioskActor.mockResolvedValue(null);
    await expect(kioskActionForm("check_kiosk_pin", form({}))).resolves.toEqual(
      {
        ok: false,
        code: "UNAUTHENTICATED",
        message: NOT_PAIRED_MESSAGE,
      },
    );
  });

  it("turns a throw into INTERNAL, but lets Next's redirect through", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    getKioskActor.mockRejectedValue(new Error("db down"));
    await expect(
      kioskActionForm("check_kiosk_pin", form({})),
    ).resolves.toMatchObject({ ok: false, code: "INTERNAL" });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();

    getKioskActor.mockImplementation(async () => redirect("/kiosk/pair"));
    await expect(
      kioskActionForm("check_kiosk_pin", form({})),
    ).rejects.toThrow();
  });
});
