import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nameFromFile } from "./avatar-forms";

// /admin/avatars' uploader (issue #111): the file input is off while a set
// is being cleaned, and an answer that arrives after a newer choice is
// dropped, never shown over the newer preview.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("./actions", () => ({
  archiveAvatarAction: vi.fn(),
  restoreAvatarAction: vi.fn(),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Answer = { resolve: (body: unknown) => void };
let answers: Answer[];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  answers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) =>
          answers.push({
            resolve: (body) => resolve({ json: async () => body }),
          }),
        ),
    ),
  );
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const preview = (width: number) => ({
  ok: true,
  data: {
    height: 64,
    figures: [{ preview: `data:image/png;base64,${width}`, width, height: 64 }],
  },
});

function pick(input: HTMLInputElement, name: string) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([new Uint8Array(4)], name, { type: "image/png" })],
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AvatarUploader", () => {
  it("turns the file input off while cleaning, and drops a stale answer", async () => {
    const { AvatarUploader } = await import("./avatar-forms");
    act(() => root.render(<AvatarUploader />));
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.disabled).toBe(false);

    await act(async () => pick(input, "first.png"));
    expect(input.disabled).toBe(true);
    // A second choice before the first answer (as a script could send).
    await act(async () => pick(input, "second.png"));
    expect(answers).toHaveLength(2);

    // The newer answer first, then the older one late.
    await act(async () => answers[1]!.resolve(preview(22)));
    await act(async () => answers[0]!.resolve(preview(11)));
    const figure = container.querySelector('[data-testid="avatar-figure"]');
    expect(figure?.textContent).toContain("22 × 64 px");
    expect(figure?.textContent).not.toContain("11 × 64 px");
    expect(input.disabled).toBe(false);
  });
});

describe("nameFromFile", () => {
  it("makes a name from a file name", () => {
    expect(nameFromFile("ryan-shades_v2.png")).toBe("Ryan shades v2");
  });
});
