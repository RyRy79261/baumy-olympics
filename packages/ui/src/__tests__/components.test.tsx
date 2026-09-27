import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell, navItemClass } from "../app-shell";
import { Button, buttonClass } from "../button";
import { Card } from "../card";
import { cx } from "../cx";
import { Field, FormMessage, Input, Select } from "../field";
import { PageHeading } from "../page-heading";
import { Sprite } from "../sprite";

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
      /bg-red-700.*min-h-14.*extra/,
    );
    expect(html(<Button variant="secondary">x</Button>)).toContain("border");
    expect(buttonClass("ghost")).toContain("underline-offset-4");
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
    expect(navItemClass(true)).toContain("font-semibold");
    expect(navItemClass(false)).not.toContain("font-semibold");
    expect(
      html(
        <AppShell brand="B" nav={null}>
          x
        </AppShell>,
      ),
    ).not.toContain("gap-3 text-sm");
  });
});

describe("Sprite (placeholder)", () => {
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
});
