import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ReportBugData } from "@/lib/actions/report-bug";
import type { ActionResult } from "@/lib/actions/result";
import { clearClientErrors } from "@/lib/feedback/client-errors";
import type { SendReport } from "./report-bug-dialog";

// The reporter in the browser (issue #133), after camp-404's
// report-bug-dialog.test.tsx: what it sends, what it shows back, that the
// diagnostics go only when ticked and exactly as shown; and the gate: a
// shake opens it, an uncaught error offers it once, "Not now" holds it.

const reportBugAction =
  vi.fn<
    (input: unknown, requestId: string) => Promise<ActionResult<ReportBugData>>
  >();
const kioskReportBugAction =
  vi.fn<
    (input: unknown, requestId: string) => Promise<ActionResult<ReportBugData>>
  >();
vi.mock("@/components/feedback/actions", () => ({
  reportBugAction: (i: unknown, r: string) => reportBugAction(i, r),
  kioskReportBugAction: (i: unknown, r: string) => kioskReportBugAction(i, r),
}));

const { ReportBugDialog } = await import("./report-bug-dialog");
const { FeedbackGate, resetOfferState } = await import("./feedback-gate");
const { openReportProblem } = await import("./report-problem");
const { ErrorRecovery } = await import("./error-recovery");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

let root: Root | null = null;
beforeEach(() => {
  reportBugAction.mockReset();
  kioskReportBugAction.mockReset();
  window.sessionStorage.clear();
  resetOfferState();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  clearClientErrors();
});

async function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

function textarea(): HTMLTextAreaElement {
  return document.getElementById("report-description") as HTMLTextAreaElement;
}

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(textarea(), value);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no button "${name}"`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
}

const FILED: ActionResult<ReportBugData> = {
  ok: true,
  data: { number: 7, url: "https://github.com/o/r/issues/7" },
};

describe("ReportBugDialog", () => {
  it("sends the report with one request id per report, and shows the issue", async () => {
    const send = vi.fn<SendReport>(async () => FILED);
    await mount(<ReportBugDialog open onClose={() => {}} send={send} />);
    expect(document.body.textContent).toContain("Report a bug");
    expect(button("Send report").disabled).toBe(true);
    await type("The log button does nothing");
    await click(button("Send report"));
    const [input, requestId] = send.mock.calls[0] as unknown as [
      Record<string, unknown>,
      string,
    ];
    expect(input).toEqual({
      kind: "bug",
      description: "The log button does nothing",
      useAi: false,
      route: "/",
    });
    expect(requestId).toMatch(/.{8,}/);
    expect(document.body.textContent).toContain("Report filed");
    const link = [...document.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("View issue #7"),
    );
    expect(link?.getAttribute("href")).toBe("https://github.com/o/r/issues/7");
  });

  const idsOf = (send: ReturnType<typeof vi.fn<SendReport>>) =>
    send.mock.calls.map((c) => c[1]);

  it("after a refusal, an edit and a resend is a new request, not a conflict", async () => {
    const send = vi.fn<SendReport>(async () => ({
      ok: false,
      code: "UNAVAILABLE",
      message: "Couldn't reach the bug tracker just now.",
    }));
    await mount(<ReportBugDialog open onClose={() => {}} send={send} />);
    await type("x");
    await click(button("Send report"));
    expect(document.querySelector("[role=alert]")?.textContent).toContain(
      "Couldn't reach the bug tracker",
    );
    await type("x, and more detail");
    await click(button("Send report"));
    await click(button("Send report"));
    const [first, second, third] = idsOf(send);
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it("keeps the id when the transport failed and the same report is sent again, but not once it is edited", async () => {
    const send = vi.fn<SendReport>(async () => {
      throw new Error("network");
    });
    await mount(<ReportBugDialog open onClose={() => {}} send={send} />);
    await type("x");
    await click(button("Send report"));
    await click(button("Send report"));
    await type("x, edited");
    await click(button("Send report"));
    const [first, retry, edited] = idsOf(send);
    expect(retry).toBe(first);
    expect(edited).not.toBe(first);
  });

  it("says so when the send itself fails", async () => {
    const send = vi.fn<SendReport>(async () => {
      throw new Error("network");
    });
    await mount(<ReportBugDialog open onClose={() => {}} send={send} />);
    await type("x");
    await click(button("Send report"));
    expect(document.querySelector("[role=alert]")?.textContent).toMatch(
      /couldn't send/i,
    );
  });

  it("offers Improve with AI only when Claude is set up, and sends it ticked", async () => {
    const send = vi.fn<SendReport>(async () => FILED);
    await mount(<ReportBugDialog open onClose={() => {}} send={send} />);
    expect(document.getElementById("report-use-ai")).toBeNull();
    act(() => root?.unmount());
    root = null;
    await mount(
      <ReportBugDialog open onClose={() => {}} send={send} aiAvailable />,
    );
    expect(document.getElementById("report-use-ai")).not.toBeNull();
    await type("x");
    await click(button("Send report"));
    expect(send.mock.calls[0]![0]).toMatchObject({ useAi: true });
  });

  it("sends no diagnostics unless ticked, and then exactly what it shows", async () => {
    const send = vi.fn<SendReport>(async () => FILED);
    await mount(<ReportBugDialog open onClose={() => {}} send={send} />);
    await type("x");
    await click(button("Send report"));
    expect(send.mock.calls[0]![0]).not.toHaveProperty("diagnostics");

    act(() => root?.unmount());
    root = null;
    await mount(<ReportBugDialog open onClose={() => {}} send={send} />);
    await click(
      document.getElementById("report-attach-diagnostics") as HTMLElement,
    );
    const panel = button(`What this attaches5 fields ▴`);
    expect(panel.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(panel.getAttribute("aria-controls")!)!;
    expect(body.hidden).toBe(false);
    expect(body.textContent).toContain("Browser");
    expect(body.textContent).toContain("No recent errors on this page.");
    await type("y");
    await click(button("Send report"));
    const sent = send.mock.calls[1]![0] as unknown as {
      diagnostics: { environment: { label: string }[]; errors: unknown[] };
    };
    expect(sent.diagnostics.environment.map((f) => f.label)).toContain(
      "Browser",
    );
    expect(sent.diagnostics.errors).toEqual([]);
  });

  it("starts from the text it was opened with, and says why it cannot send", async () => {
    await mount(
      <ReportBugDialog
        open
        onClose={() => {}}
        send={vi.fn()}
        defaultDescription="Trace: abc123"
        blocked="Tap your avatar first."
      />,
    );
    expect(textarea().value).toBe("Trace: abc123");
    expect(document.body.textContent).toContain("Tap your avatar first.");
    expect(() => button("Send report")).toThrow();
  });
});

/** A devicemotion event with a timestamp, as an iPad sends them. */
function motion(z: number, at: number): Event {
  const e = new Event("devicemotion");
  Object.defineProperty(e, "accelerationIncludingGravity", {
    value: { x: 0, y: 0, z },
  });
  Object.defineProperty(e, "timeStamp", { value: at });
  return e;
}

describe("FeedbackGate", () => {
  it("opens the reporter on a shake, and sends from the kiosk as the kiosk", async () => {
    kioskReportBugAction.mockResolvedValue(FILED);
    await mount(<FeedbackGate surface="kiosk" aiAvailable={false} />);
    const dialog = () => document.querySelector("dialog");
    expect(dialog()?.hasAttribute("open")).toBe(false);
    // Four jolts are a bump, not a shake.
    await act(async () => {
      [9.8, 25, 9.8, 25, 9.8].forEach((z, i) =>
        window.dispatchEvent(motion(z, 1000 + i * 70)),
      );
    });
    expect(dialog()?.hasAttribute("open")).toBe(false);
    await act(async () => {
      window.dispatchEvent(motion(25, 1000 + 5 * 70));
    });
    expect(dialog()?.hasAttribute("open")).toBe(true);
    await type("Shop page is blank");
    await click(button("Send report"));
    expect(kioskReportBugAction).toHaveBeenCalledOnce();
    expect(reportBugAction).not.toHaveBeenCalled();
  });

  it("opens with a prefill and a kind when asked", async () => {
    await mount(<FeedbackGate surface="ui" aiAvailable={false} />);
    await act(async () =>
      openReportProblem({ kind: "feature", description: "Dark mode" }),
    );
    expect(document.body.textContent).toContain("Request a feature");
    expect(textarea().value).toBe("Dark mode");
  });

  it("offers Report this bug once for an uncaught error, and Not now holds it", async () => {
    await mount(<FeedbackGate surface="ui" aiAvailable={false} />);
    const offer = () => document.querySelector("[data-testid=report-offer]");
    await act(async () => {
      console.error("handled elsewhere");
    });
    expect(offer()).toBeNull();
    await act(async () => {
      window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    });
    expect(offer()).not.toBeNull();
    await click(button("Not now"));
    expect(offer()).toBeNull();
    await act(async () => {
      window.dispatchEvent(new ErrorEvent("error", { message: "boom again" }));
    });
    expect(offer()).toBeNull();
  });

  it("keeps the limit when sessionStorage throws", async () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    try {
      await mount(<FeedbackGate surface="ui" aiAvailable={false} />);
      const offer = () => document.querySelector("[data-testid=report-offer]");
      await act(async () => {
        window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
      });
      expect(offer()).not.toBeNull();
      await click(button("Not now"));
      await act(async () => {
        window.dispatchEvent(new ErrorEvent("error", { message: "again" }));
      });
      expect(offer()).toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("the error page offers Report only while a reporter is mounted", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("x"), { digest: "abc123" });
    await mount(<ErrorRecovery error={error} reset={() => {}} />);
    expect(document.body.textContent).toContain("Try again");
    expect(() => button("Report")).toThrow();
    act(() => root?.unmount());
    root = null;
    await mount(
      <>
        <ErrorRecovery error={error} reset={() => {}} />
        <FeedbackGate surface="ui" aiAvailable={false} />
      </>,
    );
    await click(button("Report"));
    expect(textarea().value).toContain("Trace: abc123");
    quiet.mockRestore();
  });

  it("Report this bug opens the reporter", async () => {
    await mount(<FeedbackGate surface="ui" aiAvailable={false} />);
    await act(async () => {
      window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    });
    await click(button("Report this bug"));
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(document.querySelector("[data-testid=report-offer]")).toBeNull();
  });
});
