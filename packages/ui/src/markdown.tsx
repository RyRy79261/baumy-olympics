import Markdown from "react-markdown";
import rehypeSanitize, {
  type Options as SanitizeSchema,
} from "rehype-sanitize";
import { cx } from "./cx";

// MarkdownBody: a note's body (SPEC §3.5), and the ONLY way a note's
// markdown reaches the page. Ported from camp-404
// `apps/web/components/announcements/markdown-body.tsx` (react-markdown
// behind rehype-sanitize), cut down for sticky notes. Server-renderable: no
// hooks, no DOM.
//
// SAFETY. A note is written by one member (or by the AI, or brain) and read
// by everyone, on every phone and the kitchen screen, so the renderer is the
// boundary, not the form:
//   - raw HTML never becomes markup. `remarkHtmlAsText` turns every html node
//     back into the text it was typed as before anything can become an
//     element, so a <script> or an onerror= shows as characters (React
//     escapes them) instead of vanishing or running.
//   - the schema is an ALLOW-list built from nothing: the tags markdown makes,
//     and on them only href and title. No images at all: a note has no
//     storage of its own, and an image from any host is a tracking pixel on
//     the kitchen screen. An image shows its alt text.
//   - a link keeps only http, https and mailto, or a path in this app.
//     Anything else (javascript:, data:, vbscript:) loses its href and is
//     plain text.
//   - headings become bold lines, so a note cannot break the page's heading
//     outline.
// `__tests__/markdown.test.tsx` holds each of those to a test.
//
// LINE BREAKS. A single newline is a line break (not CommonMark), because a
// note is typed like a sticky note: "Plumber Tue\nKey under the mat" is two
// lines. A blank line still starts a new paragraph.

/** Just enough of mdast to walk it. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** Replace each child of every node, depth first. */
function replaceChildren(
  node: MdNode,
  fn: (child: MdNode, parent: MdNode) => MdNode | MdNode[],
): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    const replaced = fn(child, node);
    if (Array.isArray(replaced)) next.push(...replaced);
    else next.push(replaced);
  }
  node.children = next;
  for (const child of node.children) replaceChildren(child, fn);
}

/** The nodes whose children are blocks, not prose. */
const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem"]);

/** Raw HTML → the text it was typed as (see SAFETY). */
function remarkHtmlAsText() {
  return (tree: MdNode) => {
    replaceChildren(tree, (child, parent) => {
      if (child.type !== "html") return child;
      const text: MdNode = { type: "text", value: child.value ?? "" };
      return BLOCK_PARENTS.has(parent.type)
        ? { type: "paragraph", children: [text] }
        : text;
    });
  };
}

/** Every image → its alt text: a note never loads an image (see SAFETY). */
function remarkImagesAsAlt() {
  return (tree: MdNode & { alt?: string | null }) => {
    replaceChildren(tree, (child) => {
      if (child.type !== "image" && child.type !== "imageReference") {
        return child;
      }
      const alt = (child as MdNode & { alt?: string | null }).alt ?? "";
      return { type: "text", value: alt };
    });
  };
}

/** A single newline → a hard break (see LINE BREAKS). */
function remarkLineBreaks() {
  return (tree: MdNode) => {
    replaceChildren(tree, (child, parent) => {
      if (child.type !== "text" || BLOCK_PARENTS.has(parent.type)) return child;
      const value = child.value ?? "";
      if (!value.includes("\n")) return child;
      const pieces: MdNode[] = [];
      value.split("\n").forEach((line, i) => {
        if (i > 0) pieces.push({ type: "break" });
        if (line !== "") pieces.push({ type: "text", value: line });
      });
      return pieces;
    });
  };
}

/** The tags markdown makes, minus images; everything else is unwrapped. */
export const NOTE_SANITIZE_SCHEMA: SanitizeSchema = {
  tagNames: [
    "p",
    "br",
    "strong",
    "em",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "a",
  ],
  attributes: { a: ["href", "title"], "*": [] },
  protocols: { href: ["http", "https", "mailto"] },
  clobber: ["id", "name"],
  clobberPrefix: "note-body-",
  strip: ["script", "style"],
  ancestors: { li: ["ul", "ol"] },
};

/** A link target a member's browser may follow from a note. */
export function isAllowedNoteUrl(url: string): boolean {
  const trimmed = url.trim();
  // A path in this app. "//host" and "/\host" both leave it in a browser,
  // and markdown hands the backslash over already encoded as %5C.
  if (trimmed.startsWith("/")) {
    return !trimmed.startsWith("//") && !/[\\\s]|%5c/i.test(trimmed);
  }
  if (trimmed.startsWith("#")) return true;
  return /^(?:https?|mailto):/i.test(trimmed);
}

/** The first gate on every URL: "" for one we will not carry. */
function noteUrl(value: string, key: string): string {
  return key === "href" && isAllowedNoteUrl(value) ? value : "";
}

const PROSE =
  "text-sm leading-relaxed [overflow-wrap:anywhere] " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
  "[&_a]:underline [&_a]:underline-offset-2 " +
  "[&_strong]:font-semibold [&_em]:italic " +
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-400 [&_blockquote]:pl-3 " +
  "[&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 " +
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-neutral-100 [&_pre]:p-2 " +
  "[&_hr]:my-3 [&_hr]:border-neutral-300";

function Heading({ children }: { children?: React.ReactNode }) {
  return <p className="font-semibold">{children}</p>;
}

export function MarkdownBody({
  children,
  className,
}: {
  /** The markdown, as the member typed it. */
  children: string;
  className?: string;
}) {
  return (
    <div className={cx(PROSE, className)} data-markdown>
      <Markdown
        remarkPlugins={[remarkHtmlAsText, remarkImagesAsAlt, remarkLineBreaks]}
        rehypePlugins={[[rehypeSanitize, NOTE_SANITIZE_SCHEMA]]}
        urlTransform={noteUrl}
        components={{
          h1: Heading,
          h2: Heading,
          h3: Heading,
          h4: Heading,
          h5: Heading,
          h6: Heading,
          a: ({ href, title, children: kids }) => {
            if (!href) return <>{kids}</>;
            const external = !href.startsWith("/") && !href.startsWith("#");
            return (
              <a
                href={href}
                title={title}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer nofollow" }
                  : {})}
              >
                {kids}
              </a>
            );
          },
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
