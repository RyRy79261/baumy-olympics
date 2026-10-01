import { beforeEach, describe, expect, it, vi } from "vitest";

// The kiosk frame's gate comes first (issue #128 review): an unpaired or
// revoked device is sent to /kiosk/pair before anything about the household
// is read.

const getKioskActor = vi.fn();
const householdMembers = vi.fn(async () => []);
const redirect = vi.fn((to: string) => {
  throw new Error(`redirect ${to}`);
});

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/auth", () => ({ getKioskActor: () => getKioskActor() }));
vi.mock("@/lib/members/household", () => ({
  householdMembers: () => householdMembers(),
}));
vi.mock("@/lib/background-work", () => ({ runSweepAfterResponse: vi.fn() }));
vi.mock("@/lib/integrations/groq", () => ({ voiceConfigured: () => false }));
vi.mock("@/components/baumy/baumy-sheet", () => ({ BaumySheet: () => null }));
vi.mock("@/components/kiosk/idle-reset", () => ({ IdleReset: () => null }));
vi.mock("@/components/kiosk/keep-screen-on", () => ({
  KeepScreenOn: () => null,
}));
vi.mock("@/components/kiosk/kiosk-frame", () => ({
  KioskFrame: () => null,
  KioskNav: () => null,
}));
vi.mock("@/components/kiosk/overlays", () => ({ KioskOverlays: () => null }));
vi.mock("@/components/kiosk/service-worker", () => ({
  RegisterServiceWorker: () => null,
}));
vi.mock("@/components/members/score-emote", () => ({ ScoreEmote: () => null }));
vi.mock("../actions", () => ({
  clearPickAction: vi.fn(),
  pickMemberAction: vi.fn(),
}));

const { default: KioskLayout } = await import("./layout");

beforeEach(() => {
  getKioskActor.mockReset();
  householdMembers.mockClear();
  redirect.mockClear();
});

describe("the kiosk frame", () => {
  it("reads the members for a paired device", async () => {
    getKioskActor.mockResolvedValue({ kind: "kiosk", deviceId: "d1" });
    await KioskLayout({ children: null });
    expect(householdMembers).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends an unpaired device to pairing before reading the household", async () => {
    getKioskActor.mockResolvedValue(null);
    await expect(KioskLayout({ children: null })).rejects.toThrow(
      "redirect /kiosk/pair",
    );
    expect(redirect).toHaveBeenCalledWith("/kiosk/pair");
    expect(householdMembers).not.toHaveBeenCalled();
  });
});
