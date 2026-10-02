// @vitest-environment node
import Link from "next/link";
import { describe, expect, it } from "vitest";
import { Card } from "@baumy/ui";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { allLegalSections, legalSections } from "./legal";

// The legal pages become help sections from their own element trees (issue
// #142). Only the tags those pages use are understood.

function page(...children: React.ReactNode[]) {
  return (
    <LegalPage title="T" description="D" updated="2026-10-02">
      {children}
    </LegalPage>
  );
}

describe("legalSections", () => {
  it("turns paragraphs, lists, bold, code and links into markdown", () => {
    const [section] = legalSections(
      "terms",
      page(
        <LegalSection key="a" title="Be decent, please">
          <p>
            Keep <strong>your PIN</strong> to yourself, see{" "}
            <Link href="/privacy">privacy</Link> and{" "}
            <a href="/terms">terms</a>.
          </p>
          <ul>
            <li>
              <code>
                {"baumy"}.{"session"}
              </code>
              : {3} days
            </li>
            <li>
              <>plain</>
              {null}
              {false}
            </li>
          </ul>
          {null}
        </LegalSection>,
      ),
    );
    expect(section).toEqual({
      slug: "terms-be-decent-please",
      title: "Terms: Be decent, please",
      url: "/terms#be-decent-please",
      text: "Keep **your PIN** to yourself, see [privacy](/privacy) and [terms](/terms).\n\n- `baumy.session`: 3 days\n- plain",
    });
  });

  it("reads one lone section", () => {
    const out = legalSections(
      "privacy",
      <LegalPage title="T" description="D" updated="2026-10-02">
        <LegalSection title="Only">
          <p>One.</p>
        </LegalSection>
      </LegalPage>,
    );
    expect(out.map((s) => s.url)).toEqual(["/privacy#only"]);
  });

  it("refuses anything it cannot read", () => {
    const section = (body: React.ReactNode) =>
      page(
        <LegalSection key="s" title="S">
          {body}
        </LegalSection>,
      );
    expect(() => legalSections("privacy", <p>no</p>)).toThrow(
      "The privacy page is not a LegalPage.",
    );
    expect(() => legalSections("terms", page(<p key="p">loose</p>))).toThrow(
      "The terms page holds something but LegalSections.",
    );
    expect(() => legalSections("terms", section("loose text"))).toThrow(
      "outside a <p> or a list",
    );
    expect(() => legalSections("terms", section(<h3>Head</h3>))).toThrow(
      "A legal section uses <h3>",
    );
    expect(() =>
      legalSections(
        "terms",
        section(
          <ul>
            <p>not an item</p>
          </ul>,
        ),
      ),
    ).toThrow("A legal list holds <p>, not <li>.");
    expect(() =>
      legalSections(
        "terms",
        section(
          <p>
            <em>new</em>
          </p>,
        ),
      ),
    ).toThrow("A legal page uses <em>");
    expect(() =>
      legalSections(
        "terms",
        section(
          <p>
            <Card>boxed</Card>
          </p>,
        ),
      ),
    ).toThrow("A legal page uses <Card>");
    expect(() =>
      legalSections(
        "terms",
        section(<p>{{ not: "an element" } as unknown as React.ReactNode}</p>),
      ),
    ).toThrow("not an element");
  });
});

describe("allLegalSections", () => {
  it("reads every privacy section, then every terms section", () => {
    const urls = allLegalSections().map((s) => s.url);
    expect(urls[0]).toBe("/privacy#who-runs-this");
    expect(urls).toContain("/privacy#how-long-we-keep-it");
    expect(urls.at(-1)).toBe("/terms#changes-and-contact");
  });
});
