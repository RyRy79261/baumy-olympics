// @vitest-environment node
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { auditEvents } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { seedMember, sessionActor } from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { fieldErrors } from "./result";

// The UI adapter: a server action's FormData, the session's actor and the
// request headers become one runAction call from the `ui` surface.

const getActor = vi.fn<() => Promise<Actor | null>>();
const headersMock = vi.fn(
  async () => new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }),
);
vi.mock("@/lib/auth", () => ({ getActor: () => getActor() }));
vi.mock("next/headers", () => ({ headers: () => headersMock() }));

const { actionForm, formDataToInput, uiRequestCtx } = await import("./ui");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const value of Array.isArray(v) ? v : [v]) f.append(k, value);
  }
  return f;
}

beforeEach(() => {
  getActor.mockReset();
  __resetMemoryRateLimits();
});

describe("formDataToInput", () => {
  it("keeps the action's fields, drops Next's and the request id, and skips blanks", () => {
    const f = form({
      displayName: "Ryan",
      color: "",
      requestId: "req-12345678",
      $ACTION_ID_abc: "",
      tags: ["a", "b", "c"],
    });
    f.append("photo", new Blob(["x"]), "x.png");
    expect(formDataToInput(f)).toEqual({
      displayName: "Ryan",
      tags: ["a", "b", "c"],
    });
  });
});

describe("uiRequestCtx", () => {
  it("builds the ui context from the session and headers", async () => {
    getActor.mockResolvedValue(sessionActor("m1"));
    const ctx = await uiRequestCtx("req-12345678");
    expect(ctx).toMatchObject({
      actor: { memberId: "m1" },
      source: "ui",
      householdId: HOUSEHOLD_ID,
      requestId: "req-12345678",
      ip: "9.9.9.9",
    });
    expect(ctx?.now).toBeInstanceOf(Date);
  });

  it("is null when nobody is signed in", async () => {
    getActor.mockResolvedValue(null);
    await expect(uiRequestCtx(undefined)).resolves.toBeNull();
  });
});

describe("actionForm", () => {
  it("runs the action as the signed-in member, once per request id", async () => {
    const me = await seedMember(db(), { displayName: "Old" });
    getActor.mockResolvedValue(sessionActor(me));
    const f = form({ displayName: "Ryan", requestId: "form-request-0001" });
    const res = await actionForm("update_my_profile", f);
    expect(res).toMatchObject({ ok: true, data: { displayName: "Ryan" } });
    // A double submit of the same form is a replay.
    await actionForm("update_my_profile", f);
    const audits = await t.db().select().from(auditEvents);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ source: "ui", actorMemberId: me });
  });

  it("returns field errors a form can show inline", async () => {
    const me = await seedMember(db());
    getActor.mockResolvedValue(sessionActor(me));
    const res = await actionForm(
      "update_my_profile",
      form({ color: "red", requestId: "form-request-0002" }),
    );
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(fieldErrors(res)).toEqual({ color: ["Use a colour like #ff8800."] });
  });

  it("needs a request id for a write", async () => {
    const me = await seedMember(db());
    getActor.mockResolvedValue(sessionActor(me));
    const res = await actionForm(
      "update_my_profile",
      form({ displayName: "Ryan", requestId: "" }),
    );
    expect(fieldErrors(res)).toHaveProperty("requestId");
  });

  it("returns UNAUTHENTICATED when nobody is signed in", async () => {
    getActor.mockResolvedValue(null);
    await expect(actionForm("whoami", form({}))).resolves.toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
  });

  it("turns a throw into INTERNAL, but lets Next's redirect through", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    getActor.mockRejectedValue(new Error("db down"));
    await expect(actionForm("whoami", form({}))).resolves.toEqual({
      ok: false,
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();

    getActor.mockImplementation(async () => redirect("/auth/sign-in"));
    await expect(actionForm("whoami", form({}))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
  });
});
