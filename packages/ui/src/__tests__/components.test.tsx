import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell, navItemClass } from "../app-shell";
import { Button, buttonClass } from "../button";
import { Card } from "../card";
import { cx } from "../cx";
import {
  Checkbox,
  Field,
  FormMessage,
  Input,
  Select,
  Textarea,
} from "../field";
import { PageHeading, SectionHeading } from "../page-heading";
import { ProofPhoto } from "../proof-photo";
import { BAUMY_STATES, SPRITE_MOTION, Sprite } from "../sprite";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("cx", () => {
  it("joins the truthy parts", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("Button", () => {
  it("never submits by accident and keeps a 44px touch target", () => {
    const out = html(<Button>Save</Button>);
    expect(out).toContain('type="button"');
    expect(out).toContain("min-h-11");
    expect(html(<Button type="submit">Go</Button>)).toContain('type="submit"');
  });

  it("has a variant and a kiosk size", () => {
    expect(buttonClass("danger", "kiosk", "extra")).toMatch(
      /bg-bm-red.*min-h-14.*extra/,
    );
    expect(buttonClass("primary")).toContain("bg-bm-green");
    expect(html(<Button variant="secondary">x</Button>)).toContain(
      "pixel-frame",
    );
    expect(buttonClass("ghost")).toContain("underline-offset-4");
    expect(buttonClass("ghost")).not.toContain("pixel-frame");
  });
});

describe("Card", () => {
  it("renders an optional title and description", () => {
    const out = html(
      <Card title="Members" description="Everyone">
        body
      </Card>,
    );
    expect(out).toContain("<h2");
    expect(out).toContain("Everyone");
    expect(html(<Card>only body</Card>)).not.toContain("<h2");
  });
});

describe("Input", () => {
  it("has a kiosk size of 56px", () => {
    expect(html(<Input kiosk />)).toContain("min-h-14");
    expect(html(<Input />)).not.toContain("min-h-14");
  });
});

describe("Textarea", () => {
  it("is a control, larger on the kiosk", () => {
    expect(html(<Textarea name="reason" />)).toContain("<textarea");
    expect(html(<Textarea kiosk />)).toContain("text-xl");
    expect(html(<Textarea />)).not.toContain("text-xl");
  });
});

describe("ProofPhoto", () => {
  it("shows the proxied photo with its alt text", () => {
    const out = html(<ProofPhoto src="/api/blob?pathname=x" alt="Proof" />);
    expect(out).toContain('src="/api/blob?pathname=x"');
    expect(out).toContain('alt="Proof"');
  });
});

describe("Field", () => {
  it("ties the label, hint and errors to the control", () => {
    const out = html(
      <Field id="pin" label="PIN" hint="4 to 6 digits" errors={["Too short."]}>
        {(control) => <Input {...control} />}
      </Field>,
    );
    expect(out).toContain('for="pin"');
    expect(out).toContain('aria-describedby="pin-hint pin-error"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('id="pin-error"');
    expect(out).toContain("Too short.");
  });

  it("adds no description or invalid flag when there is nothing to say", () => {
    const out = html(
      <Field id="role" label="Role" errors={[]}>
        {(control) => (
          <Select {...control}>
            <option>member</option>
          </Select>
        )}
      </Field>,
    );
    expect(out).toContain("<select");
    expect(out).not.toContain("aria-describedby");
    expect(out).not.toContain("aria-invalid");
  });

  it("FormMessage is an alert for errors and a status for success", () => {
    expect(html(<FormMessage tone="error">No</FormMessage>)).toContain(
      'role="alert"',
    );
    expect(html(<FormMessage tone="success">Yes</FormMessage>)).toContain(
      'role="status"',
    );
  });
});

describe("Checkbox", () => {
  it("labels its box, ties the hint to it and keeps a 44px row", () => {
    const out = html(
      <Checkbox
        id="scope-read"
        name="scope"
        value="baumy:read"
        label="Read"
        hint="See things"
        defaultChecked
      >
        <ul>
          <li>Your chores</li>
        </ul>
      </Checkbox>,
    );
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('for="scope-read"');
    expect(out).toContain('aria-describedby="scope-read-hint"');
    expect(out).toContain('checked=""');
    expect(out).toContain("min-h-11");
    expect(out).toContain("<li>Your chores</li>");
  });

  it("has no hint id when there is no hint", () => {
    expect(html(<Checkbox id="x" label="X" />)).not.toContain(
      "aria-describedby",
    );
  });
});

describe("PageHeading", () => {
  it("renders the one h1, with the optional parts", () => {
    const full = html(
      <PageHeading
        eyebrow="Admin"
        title="Members"
        description="Who lives here"
        actions={<button>Add</button>}
      />,
    );
    expect(full.match(/<h1/g)).toHaveLength(1);
    expect(full).toContain("Admin");
    expect(full).toContain("Who lives here");
    expect(full).toContain("Add");
    const bare = html(<PageHeading title="Hub" />);
    expect(bare).toContain("Hub");
    expect(bare).not.toContain("<p");
  });

  it("has a quieter h2 for a section inside a page", () => {
    const out = html(<SectionHeading id="yours">Your claims</SectionHeading>);
    expect(out).toMatch(/^<h2 id="yours"/);
    expect(out).toContain("font-label");
    expect(out).toContain("Your claims");
  });
});

describe("AppShell", () => {
  it("has a labelled main nav and one content column", () => {
    const out = html(
      <AppShell
        brand="Baumy"
        nav={<a className={navItemClass(true)}>Hub</a>}
        user={<span>Ryan</span>}
      >
        page
      </AppShell>,
    );
    expect(out).toContain('aria-label="Main"');
    expect(out).toContain("<main");
    expect(out).toContain("Ryan");
    expect(navItemClass(true)).toContain("pixel-frame");
    expect(navItemClass(false)).not.toContain("pixel-frame");
    expect(
      html(
        <AppShell brand="B" nav={null}>
          x
        </AppShell>,
      ),
    ).not.toContain("gap-3 text-sm");
  });
});

describe("Sprite", () => {
  it("exposes the sprite name, state and scale", () => {
    const out = html(
      <Sprite name="fox" state="happy" size={3} color="#ff0000" label="Ryan" />,
    );
    expect(out).toContain('data-sprite="fox"');
    expect(out).toContain('data-state="happy"');
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Ryan"');
    expect(out).toContain("width:48px");
    expect(out).toContain("background-color:#ff0000");
  });

  it("is decorative without a label, and idles by default", () => {
    const out = html(<Sprite name="cat" />);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('data-state="idle"');
    expect(out).toContain("width:32px");
  });

  it("has Baumy's seven states, each moving only when motion is allowed", () => {
    expect(BAUMY_STATES).toEqual([
      "idle",
      "listening",
      "thinking",
      "talking",
      "happy",
      "sad",
      "sleeping",
    ]);
    for (const state of BAUMY_STATES) {
      const out = html(<Sprite name="baumy" state={state} label="Baumy" />);
      expect(out).toContain(`data-state="${state}"`);
      const motion = SPRITE_MOTION[state];
      if (motion) {
        expect(motion.startsWith("motion-safe:")).toBe(true);
        expect(out).toContain(motion);
        expect(out).toContain('data-motion="animated"');
      } else {
        expect(out).toContain('data-motion="still"');
        expect(out).not.toMatch(/animate-pixel-/);
      }
      // No animation class outside motion-safe.
      expect(out.replace(/motion-safe:animate-\w+/g, "")).not.toMatch(
        /animate-/,
      );
    }
    // A still state is marked some other way than motion.
    expect(html(<Sprite name="baumy" state="sad" />)).toContain(">x</span>");
    expect(html(<Sprite name="baumy" state="sleeping" />)).toContain("z");
    expect(html(<Sprite name="baumy" state="idle" />)).not.toContain(
      "data-mark",
    );
  });
});
