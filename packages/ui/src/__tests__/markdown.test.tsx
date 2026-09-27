import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody, isAllowedNoteUrl } from "../markdown";

// The note renderer is the security boundary (SPEC §3.5, issue #20): a note
// is written by one member, the AI or brain, and read on every screen. These
// tests hold the claims in markdown.tsx's header to something that can fail.

const html = (md: string) =>
  renderToStaticMarkup(<MarkdownBody>{md}</MarkdownBody>);

/** The text a reader sees, with the markup gone and entities decoded. */
const text = (out: string) =>
  out
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("MarkdownBody: what it renders", () => {
  it("renders the markdown a member writes", () => {
    const out = html(
      [
        "**Plumber** comes *Tuesday*.",
        "",
        "- Key under the mat",
        "- Water off at 9",
        "",
        "> Ask for Jo.",
        "",
        "Code: `1234`",
      ].join("\n"),
    );
    expect(out).toContain("<strong>Plumber</strong>");
    expect(out).toContain("<em>Tuesday</em>");
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out).toContain("<blockquote>");
    expect(out).toContain("<code>1234</code>");
  });

  it("keeps single line breaks, and a blank line starts a paragraph", () => {
    const out = html("Plumber Tue\nKey under the mat\n\nThanks");
    expect(out.match(/<br\/>/g)).toHaveLength(1);
    expect(out.match(/<p>/g)).toHaveLength(2);
  });

  it("turns headings into bold lines, never h1 to h6", () => {
    const out = html("# Big\n\n### Small");
    expect(out).toContain('<p class="font-semibold">Big</p>');
    expect(out).toContain('<p class="font-semibold">Small</p>');
    expect(out).not.toMatch(/<h[1-6]/);
  });

  it("carries an http link, opened away from the app", () => {
    const out = html("[the wiki](https://example.com/x)");
    expect(out).toContain('href="https://example.com/x"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("keeps a link into the app in the same tab", () => {
    const out = html("[chores](/chores)");
    expect(out).toContain('<a href="/chores">chores</a>');
  });

  it("keeps a mailto link", () => {
    expect(html("[mail](mailto:jo@example.com)")).toContain(
      'href="mailto:jo@example.com"',
    );
  });
});

describe("MarkdownBody: what it refuses", () => {
  it("never renders a <script>, and shows it as typed", () => {
    const out = html(
      "Before\n\n<script>window.pwned = true;</script>\n\nAfter",
    );
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
    expect(text(out)).toContain("<script>window.pwned = true;</script>");
    expect(text(out)).toContain("Before");
    expect(text(out)).toContain("After");
  });

  it("never keeps an event handler or inline html", () => {
    const out = html(
      'Hi <img src="x" onerror="alert(1)"> and <b onclick="alert(2)">bold</b>',
    );
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b ");
    expect(out).not.toMatch(/<[^>]+\sonerror=/);
    expect(out).not.toMatch(/<[^>]+\sonclick=/);
    expect(text(out)).toContain('onerror="alert(1)"');
  });

  it("drops the href of a javascript:, data: or vbscript: link, keeping its words", () => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      const out = html(`[tap me](${url})`);
      expect(out, url).not.toContain("<a");
      expect(out, url).not.toMatch(/javascript:|vbscript:|data:/i);
      expect(text(out), url).toContain("tap me");
    }
  });

  it("drops a link that leaves the app through // or a backslash", () => {
    for (const url of ["//evil.example.com", "/\\evil.example.com"]) {
      const out = html(`[home](${url})`);
      expect(out, url).not.toContain("<a");
      expect(text(out)).toContain("home");
    }
  });

  it("never loads an image, from any host, and keeps its alt text", () => {
    const out = html(
      "![the router](https://evil.example.com/pixel.gif) and ![x][ref]\n\n[ref]: https://evil.example.com/2.gif",
    );
    expect(out).not.toContain("<img");
    expect(out).not.toContain("evil.example.com");
    expect(text(out)).toContain("the router");
  });

  it("does not let a note clobber an id on the page", () => {
    const out = html("[x](#top)");
    expect(out).toContain('href="#top"');
    expect(out).not.toContain(' id="');
  });
});

describe("isAllowedNoteUrl", () => {
  it("allows web, mail, in-app paths and anchors only", () => {
    expect(isAllowedNoteUrl("https://a.b")).toBe(true);
    expect(isAllowedNoteUrl("HTTP://a.b")).toBe(true);
    expect(isAllowedNoteUrl("mailto:a@b.c")).toBe(true);
    expect(isAllowedNoteUrl(" /notes ")).toBe(true);
    expect(isAllowedNoteUrl("#top")).toBe(true);
    expect(isAllowedNoteUrl("/a b")).toBe(false);
    expect(isAllowedNoteUrl("/%5Cevil.example.com")).toBe(false);
    expect(isAllowedNoteUrl("ftp://a.b")).toBe(false);
    expect(isAllowedNoteUrl("tel:123")).toBe(false);
  });
});
