import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthEmail,
  RESEND_ENDPOINT,
  sendAuthEmail,
  type CapturedAuthEmail,
} from "../email";

const URL_ = "https://baumy.example/api/auth/reset-password/tok?callbackURL=x";

describe("buildAuthEmail", () => {
  it("puts the link in the reset and verify emails", () => {
    for (const kind of ["reset", "verify"] as const) {
      const { subject, text } = buildAuthEmail({
        to: "a@b.c",
        kind,
        url: URL_,
      });
      expect(subject).toContain("Baumy Olympics");
      expect(text).toContain(URL_);
    }
  });

  it("says every device was signed out after a reset, with no link", () => {
    const { text } = buildAuthEmail({
      to: "a@b.c",
      kind: "password-reset-completed",
    });
    expect(text).toContain("signed out");
    expect(text).not.toContain("http");
  });

  it("tells the owner a password was added, and what to do if it wasn't them", () => {
    const { subject, text } = buildAuthEmail({
      to: "a@b.c",
      kind: "password-set",
    });
    expect(subject).toContain("password was added");
    expect(text).toContain("If it wasn't");
    expect(text).toContain("Security");
    expect(text).not.toContain("http");
  });

  it("tolerates a missing link", () => {
    expect(buildAuthEmail({ to: "a@b.c", kind: "reset" }).text).toContain(
      "expires in 1 hour",
    );
    expect(buildAuthEmail({ to: "a@b.c", kind: "verify" }).text).toContain(
      "expires in 1 hour",
    );
  });
});

describe("sendAuthEmail", () => {
  const fetchMock = vi.fn();
  let dir: string;

  beforeEach(async () => {
    vi.stubGlobal("fetch", fetchMock);
    dir = await mkdtemp(path.join(tmpdir(), "baumy-auth-mail-"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    await rm(dir, { recursive: true, force: true });
  });

  it("appends one JSON line per email to the e2e capture file and sends nothing", async () => {
    const file = path.join(dir, "nested", "mail.jsonl");
    const env = { E2E_TEST_MODE: "1", AUTH_EMAIL_CAPTURE_FILE: file };
    const at = new Date("2026-09-27T10:00:00Z");

    expect(
      await sendAuthEmail(env, { to: "a@b.c", kind: "reset", url: URL_ }, at),
    ).toBe(true);
    expect(
      await sendAuthEmail(env, {
        to: "a@b.c",
        kind: "password-reset-completed",
      }),
    ).toBe(true);

    const lines = (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as CapturedAuthEmail);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      at: at.toISOString(),
      to: "a@b.c",
      kind: "reset",
      url: URL_,
    });
    expect(lines[1]).toMatchObject({ kind: "password-reset-completed" });
    expect(lines[1]?.url).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a capture file it cannot write, without throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // A directory where the file should be: appendFile fails.
    const env = { E2E_TEST_MODE: "1", AUTH_EMAIL_CAPTURE_FILE: dir };
    expect(
      await sendAuthEmail(env, { to: "a@b.c", kind: "reset", url: URL_ }),
    ).toBe(false);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("[auth:email:capture]"),
    );
  });

  it("logs the link locally when no provider is set", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      await sendAuthEmail({}, { to: "a@b.c", kind: "reset", url: URL_ }),
    ).toBe(false);
    expect(info.mock.calls[0]?.[0]).toContain(URL_);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a working link out of a deployment's logs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendAuthEmail(
      { VERCEL_ENV: "preview" },
      { to: "a@b.c", kind: "reset", url: URL_ },
    );
    const logged = String(info.mock.calls[0]?.[0]);
    expect(logged).toContain("[link withheld from deployment logs]");
    expect(logged).not.toContain(URL_);
  });

  it("never captures on a deployment, even with the capture file set", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const file = path.join(dir, "mail.jsonl");
    await sendAuthEmail(
      {
        E2E_TEST_MODE: "1",
        AUTH_EMAIL_CAPTURE_FILE: file,
        VERCEL_ENV: "production",
      },
      { to: "a@b.c", kind: "reset", url: URL_ },
    );
    await expect(readFile(file, "utf8")).rejects.toThrow();
    expect(info).toHaveBeenCalled();
  });

  const resend = {
    RESEND_API_KEY: " re_test ",
    RESEND_FROM_EMAIL: "Baumy <hi@baumy.example>",
  };

  it("sends to exactly one recipient through Resend", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(
      await sendAuthEmail(resend, { to: "a@b.c", kind: "reset", url: URL_ }),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe(RESEND_ENDPOINT);
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer re_test",
    );
    const body = JSON.parse(String(init.body)) as {
      to: string[];
      from: string;
      text: string;
    };
    expect(body.to).toEqual(["a@b.c"]);
    expect(body.from).toBe("Baumy <hi@baumy.example>");
    expect(body.text).toContain(URL_);
  });

  it("reports a refused send by status only, without throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response("echo of re_test", { status: 422 }),
    );
    expect(await sendAuthEmail(resend, { to: "a@b.c", kind: "reset" })).toBe(
      false,
    );
    expect(error).toHaveBeenCalledWith("[auth:email] Resend responded 422");
  });

  it("survives a network failure, without logging its message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("fetch failed re_test"));
    expect(await sendAuthEmail(resend, { to: "a@b.c", kind: "verify" })).toBe(
      false,
    );
    expect(String(error.mock.calls[0]?.[0])).not.toContain("re_test");
    fetchMock.mockRejectedValue("a string");
    expect(await sendAuthEmail(resend, { to: "a@b.c", kind: "verify" })).toBe(
      false,
    );
  });
});
