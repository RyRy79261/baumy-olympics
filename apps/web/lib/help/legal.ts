import {
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import {
  LegalPage,
  LegalSection,
  legalAnchor,
} from "@/components/legal/legal-page";

// The privacy and terms pages as help sections (issue #142): each
// LegalSection becomes one section, its words turned into markdown straight
// from the page's own element tree, so the constants the page reads (cookie
// names, retention days) flow into the corpus with no copy to drift. Only the
// tags those pages use are understood; a new one fails here until it is.

export interface LegalHelpSection {
  /** `privacy-how-long-we-keep-it` */
  slug: string;
  /** `Privacy: How long we keep it` */
  title: string;
  /** `/privacy#how-long-we-keep-it`, the section's anchor (LegalSection). */
  url: string;
  /** The section's words as markdown. */
  text: string;
}

type Props = { children?: ReactNode; href?: unknown; title?: unknown };

function props(el: ReactElement): Props {
  return el.props as Props;
}

/** Inline content (text, bold, code, links) as one line of markdown. */
function inline(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(inline).join("");
  if (!isValidElement(node)) {
    throw new Error("A legal page holds something that is not an element.");
  }
  const { children, href } = props(node);
  if (node.type === Fragment) return inline(children);
  if (node.type === "strong") return `**${inline(children)}**`;
  if (node.type === "code") return `\`${inline(children)}\``;
  if (node.type === Link || node.type === "a") {
    return `[${inline(children)}](${String(href)})`;
  }
  throw new Error(
    `A legal page uses <${tagName(node)}>, which help can't read.`,
  );
}

function tagName(el: ReactElement): string {
  const t = el.type as string | { name?: string };
  return typeof t === "string" ? t : (t.name ?? "component");
}

function line(node: ReactNode): string {
  return inline(node).replace(/\s+/g, " ").trim();
}

/** A section's blocks (paragraphs and lists) as markdown paragraphs. */
function blocks(node: ReactNode): string[] {
  const out: string[] = [];
  for (const child of Array.isArray(node) ? node.flat() : [node]) {
    if (child === null || child === undefined || child === false) continue;
    if (!isValidElement(child)) {
      throw new Error("A legal section holds text outside a <p> or a list.");
    }
    const { children } = props(child);
    if (child.type === "p") {
      out.push(line(children));
    } else if (child.type === "ul") {
      const items = (Array.isArray(children) ? children.flat() : [children])
        .filter(isValidElement)
        .map((li) => {
          if (li.type !== "li") {
            throw new Error(`A legal list holds <${tagName(li)}>, not <li>.`);
          }
          return `- ${line(props(li).children)}`;
        });
      out.push(items.join("\n"));
    } else {
      throw new Error(
        `A legal section uses <${tagName(child)}>, which help can't read.`,
      );
    }
  }
  return out;
}

/** One rendered legal page's sections, in page order. */
export function legalSections(
  page: "privacy" | "terms",
  rendered: ReactNode,
): LegalHelpSection[] {
  if (!isValidElement(rendered) || rendered.type !== LegalPage) {
    throw new Error(`The ${page} page is not a LegalPage.`);
  }
  const label = page === "privacy" ? "Privacy" : "Terms";
  const children = props(rendered).children;
  return (Array.isArray(children) ? children.flat() : [children])
    .filter(isValidElement)
    .map((section) => {
      if (section.type !== LegalSection) {
        throw new Error(`The ${page} page holds something but LegalSections.`);
      }
      const title = String(props(section).title);
      const anchor = legalAnchor(title);
      return {
        slug: `${page}-${anchor}`,
        title: `${label}: ${title}`,
        url: `/${page}#${anchor}`,
        text: blocks(props(section).children).join("\n\n"),
      };
    });
}

/** Every section of /privacy, then /terms. */
export function allLegalSections(): LegalHelpSection[] {
  return [
    ...legalSections("privacy", PrivacyPage()),
    ...legalSections("terms", TermsPage()),
  ];
}
