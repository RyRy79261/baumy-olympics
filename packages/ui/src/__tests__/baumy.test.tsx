import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProposalItem, SpeechBubble } from "../baumy";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("SpeechBubble", () => {
  it("is a polite live region beside Baumy in the given state", () => {
    const out = html(<SpeechBubble state="think">Hmm…</SpeechBubble>);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('data-state="think"');
    expect(out).toContain('aria-label="Baumy (think)"');
    expect(out).toContain("Hmm…");
  });

  it("is an alert for an error", () => {
    const out = html(<SpeechBubble tone="error">No.</SpeechBubble>);
    expect(out).toContain('role="alert"');
    expect(out).toContain('aria-live="assertive"');
    expect(out).toContain('data-state="idle"');
  });
});

describe("ProposalItem", () => {
  it("shows the preview, the title, the tags and where it is", () => {
    const out = html(
      <ProposalItem
        preview="Log Trash for Ryan: +25 (streak 1)"
        title="Log a chore"
        state="pending"
        tags={["Needs your PIN"]}
      >
        <button>Approve</button>
      </ProposalItem>,
    );
    expect(out).toContain('data-state="pending"');
    expect(out).toContain("Log Trash for Ryan: +25 (streak 1)");
    expect(out).toContain("Needs your PIN");
    expect(out).toContain("Waiting for you");
    expect(out).toContain("<button>Approve</button>");
    expect(out).not.toContain("role=");
  });

  it("shows why it failed as an alert, and dims what is settled", () => {
    const failed = html(
      <ProposalItem preview="p" title="t" state="failed" message="Cooldown." />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Not saved");
    const saved = html(
      <ProposalItem preview="p" title="t" state="saved" message="+25" />,
    );
    expect(saved).toContain('role="status"');
    expect(saved).toContain("opacity-75");
    expect(
      html(<ProposalItem preview="p" title="t" state="saving" />),
    ).toContain("Saving…");
    expect(
      html(<ProposalItem preview="p" title="t" state="rejected" />),
    ).toContain("Rejected");
  });
});
