import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ForgetWalkIn } from "./forget-cookie";

// The kiosk's one-shot walk-in cookie is forgotten as soon as the dashboard
// that used it is on screen (issue #111).

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ForgetWalkIn", () => {
  it("clears the named cookie once it is on screen, and no other", () => {
    document.cookie = "baumy_kiosk_walk_in=m1; Path=/";
    document.cookie = "other=keep; Path=/";
    expect(document.cookie).toContain("baumy_kiosk_walk_in=m1");
    const div = document.createElement("div");
    const root = createRoot(div);
    act(() => root.render(<ForgetWalkIn />));
    expect(document.cookie).not.toContain("baumy_kiosk_walk_in");
    expect(document.cookie).toContain("other=keep");
    act(() => root.unmount());
  });
});
