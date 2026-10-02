// @vitest-environment node
import { redirect } from "next/navigation";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { findActiveMember } from "@baumy/db/members";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { KioskActor } from "@/lib/auth";
import type * as Selection from "@/lib/kiosk/selection";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";

// The kiosk adapter: the paired device and the picked member become the
// actor, the surface is `kiosk`, and the PinPad's field becomes `ctx.pin` for
// this one request, never part of the input.

const getKioskActor = vi.fn<() => Promise<KioskActor | null>>();
vi.mock("@/lib/auth", () => ({ getKioskActor: () => getKioskActor() }));
// The kiosk's cookies, to prove a face's tap never changes who is picked.
const setCookie = vi.fn();
const removeCookie = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "7.7.7.7" }),
  cookies: async () => ({ set: setCookie, delete: removeCookie }),
}));
// Picking reads through the HTTP driver; here it reads the test database.
vi.mock("@/lib/kiosk/selection", async (importOriginal) => {
  const real = await importOriginal<typeof Selection>();
  return {
    pickKioskMember: (kiosk: KioskActor | null, memberId: unknown) =>
      real.pickKioskMember(kiosk, memberId, (_db, household, id) =>
        findActiveMember(db(), household, id),
      ),
  };
});

const {
  FACE_FIELD,
  kioskActionAsFace,
  kioskActionForm,
  kioskActionInput,
  kioskRequestCtx,
  NOT_PAIRED_MESSAGE,
} = await import("./kiosk");
const { runAction } = await import("./registry");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const PIN = "4321";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});

beforeEach(() => {
  getKioskActor.mockReset();
  setCookie.mockReset();
  removeCookie.mockReset();
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

  it("gives a tapped face its own role, never the picked member's (issue #147)", async () => {
    getKioskActor.mockResolvedValue({
      kind: "kiosk",
      deviceId: "d1",
      memberId: "m-admin",
      displayName: "Admin",
      role: "admin",
    });
    const ctx = await kioskRequestCtx(undefined, undefined, {
      memberId: "m-jo",
      displayName: "Jo",
      role: "member",
    });
    expect(ctx!.actor).toMatchObject({ memberId: "m-jo", role: "member" });
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
        "approve_kiosk_pairing",
        form({ code: "ABC234", name: "x", requestId: "req-12345678" }),
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

describe("kioskActionAsFace", () => {
  const before = new Date(FIXED_NOW.getTime() - 60 * 60_000);

  async function reminder(by: string): Promise<string> {
    const r = await runAction(
      "create_reminder",
      { title: "Handyman on Wednesday" },
      ctxFor(sessionActor(by)),
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.data.reminderId;
  }

  it("acknowledges as the tapped face, and leaves whoever was picked picked", async () => {
    const ryan = await seedMember(db(), { createdAt: before });
    const jo = await seedMember(db(), {
      displayName: "Jo",
      createdAt: before,
    });
    const reminderId = await reminder(ryan);
    // Ryan was picked; Jo's face is tapped: it is Jo who has seen it.
    getKioskActor.mockResolvedValue({
      kind: "kiosk",
      deviceId: "d1",
      memberId: ryan,
      displayName: "Member",
    });
    await expect(
      kioskActionAsFace(
        "acknowledge_reminder",
        form({
          [FACE_FIELD]: jo,
          reminderId,
          requestId: "req-face-0001",
        }),
      ),
    ).resolves.toEqual({
      ok: true,
      data: { reminderId, memberId: jo, seenByEveryone: false },
    });
    // The pick is not touched: Ryan is still the one acting, so Ryan's next
    // tap is Ryan's, not Jo's.
    expect(setCookie).not.toHaveBeenCalled();
    expect(removeCookie).not.toHaveBeenCalled();
    await expect(
      kioskActionForm(
        "acknowledge_reminder",
        form({ reminderId, requestId: "req-face-0004" }),
      ),
    ).resolves.toEqual({
      ok: true,
      data: { reminderId, memberId: ryan, seenByEveryone: true },
    });
  });

  it("never lends the picked admin's role to a tapped face (issue #147)", async () => {
    // The cookie picked an admin; a member's face is tapped, with the
    // member's own right PIN: an admin action must still be refused.
    const admin = await seedMember(db(), {
      role: "admin",
      kioskPinHash: pinHash,
    });
    const jo = await seedMember(db(), {
      displayName: "Jo",
      kioskPinHash: pinHash,
    });
    getKioskActor.mockResolvedValue({
      kind: "kiosk",
      deviceId: "d1",
      memberId: admin,
      displayName: "Admin",
      role: "admin",
    });
    await expect(
      kioskActionAsFace(
        "create_bounty",
        form({
          [FACE_FIELD]: jo,
          name: "Stale role",
          points: "5",
          pin: PIN,
          requestId: "req-face-stale",
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // The admin themself, with their PIN, may.
    await expect(
      kioskActionForm(
        "create_bounty",
        form({
          name: "Admin's own",
          points: "5",
          pin: PIN,
          requestId: "req-admin-own",
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses a face that is not an active member, picking nobody", async () => {
    const ryan = await seedMember(db(), { createdAt: before });
    const gone = await seedMember(db(), {
      createdAt: before,
      deactivatedAt: before,
    });
    const reminderId = await reminder(ryan);
    getKioskActor.mockResolvedValue({ kind: "kiosk", deviceId: "d1" });
    await expect(
      kioskActionAsFace(
        "acknowledge_reminder",
        form({ [FACE_FIELD]: gone, reminderId, requestId: "req-face-0002" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(
      kioskActionAsFace(
        "acknowledge_reminder",
        form({ reminderId, requestId: "req-face-0003" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("says so when the kiosk is not paired", async () => {
    getKioskActor.mockResolvedValue(null);
    await expect(
      kioskActionAsFace(
        "acknowledge_reminder",
        form({ [FACE_FIELD]: "00000000-0000-4000-8000-000000000001" }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
      message: NOT_PAIRED_MESSAGE,
    });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("turns a throw into INTERNAL", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    getKioskActor.mockRejectedValue(new Error("db down"));
    await expect(
      kioskActionAsFace("acknowledge_reminder", form({})),
    ).resolves.toMatchObject({ ok: false, code: "INTERNAL" });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe("kioskActionInput", () => {
  it("runs structured input as the acting member, from the kiosk surface", async () => {
    const { setGithubIssuesForTests } =
      await import("@/lib/integrations/github");
    const { memoryGithub } = await import("@/lib/integrations/github-memory");
    setGithubIssuesForTests({
      ok: true,
      kind: "fake",
      repo: "e2e/fake-tracker",
      create: memoryGithub,
    });
    try {
      const me = await seedMember(db());
      getKioskActor.mockResolvedValue({
        kind: "kiosk",
        deviceId: "d1",
        memberId: me,
      });
      const res = await kioskActionInput(
        "report_bug",
        { description: "The shop page is blank" },
        "kiosk-input-0001",
      );
      expect(res).toMatchObject({ ok: true, data: { number: 1 } });
    } finally {
      setGithubIssuesForTests(null);
      const { clearMemoryIssues } =
        await import("@/lib/integrations/github-memory");
      clearMemoryIssues();
    }
  });

  it("never carries a PIN", async () => {
    const me = await seedMember(db(), { kioskPinHash: pinHash });
    getKioskActor.mockResolvedValue({
      kind: "kiosk",
      deviceId: "d1",
      memberId: me,
    });
    await expect(
      kioskActionInput("check_kiosk_pin", {}, undefined),
    ).resolves.toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
  });

  it("says so when the kiosk is not paired, and turns a throw into INTERNAL", async () => {
    getKioskActor.mockResolvedValue(null);
    await expect(
      kioskActionInput("check_kiosk_pin", {}, "kiosk-input-0002"),
    ).resolves.toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
      message: NOT_PAIRED_MESSAGE,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    getKioskActor.mockRejectedValue(new Error("db down"));
    await expect(
      kioskActionInput("check_kiosk_pin", {}, undefined),
    ).resolves.toMatchObject({ ok: false, code: "INTERNAL" });
    error.mockRestore();
    getKioskActor.mockImplementation(async () => redirect("/kiosk/pair"));
    await expect(
      kioskActionInput("check_kiosk_pin", {}, undefined),
    ).rejects.toThrow();
  });
});
