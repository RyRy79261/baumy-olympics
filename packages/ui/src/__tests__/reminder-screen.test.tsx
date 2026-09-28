// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultAvatar } from "@baumy/types";
import { SHIRT_COLOURS } from "../housemate";
import {
  ReminderScreen,
  faceColour,
  type ReminderFace,
} from "../reminder-screen";

// The kitchen screen's full-screen reminder (ADR 0005 §4): every face with
// its own "I've seen it", the count, and "Dismiss for everyone", which asks
// who first.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let div: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const FACES: ReminderFace[] = [
  {
    id: "m1",
    displayName: "Ryan",
    avatar: {
      hairStyle: "short",
      hairColor: "brown",
      skinTone: "light",
      shirtColor: "teal",
    },
    seen: true,
  },
  {
    id: "m2",
    displayName: "Jo",
    avatar: null,
    seen: false,
  },
];

type Props = Parameters<typeof ReminderScreen>[0];

function mount(props: Partial<Props> = {}) {
  const all: Props = {
    title: "Handyman on Wednesday",
    body: "The boiler man comes Wed 10:00-16:00.",
    from: "Ryan",
    faces: FACES,
    onSeen: vi.fn(),
    onDismiss: vi.fn(),
    ...props,
  };
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  act(() => root!.render(<ReminderScreen {...all} />));
  return all;
}

const button = (name: string) =>
  [...div.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent) === name,
  );

describe("faceColour", () => {
  it("is the character's shirt, chosen or default, never members.color", () => {
    expect(faceColour(FACES[0]!)).toBe(SHIRT_COLOURS.teal);
    expect(faceColour(FACES[1]!)).toBe(
      SHIRT_COLOURS[defaultAvatar("m2").shirtColor],
    );
  });
});

describe("ReminderScreen", () => {
  it("takes over the screen with the note, who posted it and the count", () => {
    const out = renderToStaticMarkup(
      <ReminderScreen
        title="Handyman on Wednesday"
        body="Someone must be home."
        from="Ryan"
        faces={FACES}
        onSeen={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain("fixed inset-0");
    expect(out).toContain("REMINDER");
    expect(out).toContain("notice.txt — from Ryan");
    expect(out).toContain("Handyman on Wednesday");
    expect(out).toContain("Someone must be home.");
    expect(out).toContain('aria-describedby="reminder-body"');
    expect(out).toContain("1 of 2 have seen it");
    // Every face is their character, and the one who has seen it says so.
    expect(out.match(/data-housemate/g)).toHaveLength(2);
    expect(out).toContain('data-face="m1" data-seen="true"');
    expect(out).toContain('data-face="m2" data-seen="false"');
    expect(out).toContain("Seen ✓");
    expect(out).toContain("I&#x27;ve seen it");
    expect(out).toContain("Dismiss for everyone");
    expect(out).toContain("everyone tap your face pls");
    // Names and the seen card take the shirt colour.
    expect(out).toContain(`color:${SHIRT_COLOURS.teal}`);
    expect(out).toContain(`background:${SHIRT_COLOURS.teal}26`);
  });

  it("leaves the body out when there is none", () => {
    const out = renderToStaticMarkup(
      <ReminderScreen
        title="Bins out"
        body=""
        from="Jo"
        faces={[]}
        onSeen={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(out).toContain("Bins out");
    expect(out).toContain("0 of 0 have seen it");
    expect(out).not.toContain("reminder-body");
  });

  it("reports a face's tap, and a face that has seen it cannot tap again", () => {
    const props = mount();
    const jo = button("I've seen it, Jo")!;
    expect(jo.disabled).toBe(false);
    act(() => jo.click());
    expect(props.onSeen).toHaveBeenCalledWith("m2");
    const ryan = button("Ryan has seen it")!;
    expect(ryan.disabled).toBe(true);
  });

  it("holds every button while a tap is on its way, and shows why one failed", () => {
    mount({ busy: true, message: "That reminder is not there any more." });
    expect(button("I've seen it, Jo")!.disabled).toBe(true);
    expect(button("Dismiss for everyone")!.disabled).toBe(true);
    expect(div.querySelector('[role="alert"]')!.textContent).toBe(
      "That reminder is not there any more.",
    );
  });

  it("asks who is dismissing it, then reports who, or goes back", () => {
    const first = mount();
    act(() => button("Dismiss for everyone")!.click());
    expect(first.onDismiss).toHaveBeenCalledOnce();
    act(() => root!.unmount());
    root = null;

    const onDismissAs = vi.fn();
    const onCancelDismiss = vi.fn();
    mount({ choosingDismisser: true, onDismissAs, onCancelDismiss });
    expect(div.textContent).toContain("Who is dismissing it for everyone?");
    expect(button("Dismiss for everyone")).toBeUndefined();
    const chooser = div.querySelector('[data-testid="reminder-dismissers"]')!;
    const jo = [...chooser.querySelectorAll("button")].find(
      (b) => b.textContent === "Jo",
    )!;
    // A long name is cut short, like on the face cards, in their colour.
    expect(jo.className).toContain("truncate");
    expect(jo.getAttribute("aria-label")).toBe("Jo");
    expect(jo.style.color).not.toBe("");
    act(() => jo.click());
    expect(onDismissAs).toHaveBeenCalledWith("m2");
    act(() => button("Cancel")!.click());
    expect(onCancelDismiss).toHaveBeenCalledOnce();
  });
});
