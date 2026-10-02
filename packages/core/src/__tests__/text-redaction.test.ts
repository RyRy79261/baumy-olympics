import { describe, expect, it } from "vitest";
import {
  describeRedactions,
  redactPii,
  sanitizeReportText,
} from "../feedback/text-redaction";

// Ported from camp-404 `packages/core/src/__tests__/text-redaction.test.ts`.
// The report goes to a PUBLIC tracker, so every rule is pinned, and so is
// what redaction cannot do.

const redact = (text: string) => redactPii(text).text;

describe("redactPii", () => {
  it("redacts emails, phone numbers, ID and card numbers, and says so", () => {
    const out = redactPii(
      "reach me at jane@example.com or +49 151 2345 6789, ID 8001015009087, card 4111 1111 1111 1111",
    );
    expect(out.text).toContain("[email]");
    expect(out.text).not.toContain("jane@example.com");
    expect(out.text).toContain("[phone]");
    expect(out.text).toContain("[id]");
    expect(out.text).toContain("[card]");
    expect(out.redacted).toEqual(["email", "phone", "id-number", "card"]);
  });

  it("fully redacts international phone numbers: no trailing group leaks", () => {
    for (const n of [
      "+49 151 2345 6789",
      "+1 415 555 2671",
      "+44 20 7946 0958",
      "+49-123-4567890",
    ]) {
      expect(redact(n)).toBe("[phone]");
    }
  });

  it("redacts space-separated local phone numbers", () => {
    expect(redact("030 555 1234")).not.toBe("030 555 1234");
    expect(redact("082 555 1234")).toBe("[phone]");
    expect(redact("call 082 555 1234 please")).toContain("[phone]");
  });

  it("redacts secrets: bearer tokens, JWTs, API keys, token-bearing URLs", () => {
    expect(redact("Authorization: Bearer abc.def-123")).toContain(
      "Bearer [token]",
    );
    expect(redact("token eyJhbGciOiJ.eyJzdWIiOiI.SflKxwRJ0eK")).toContain(
      "[jwt]",
    );
    expect(redact("key sk-livedeadbeef0123456789")).toContain("[secret]");
    expect(redact("ghp_0123456789abcdef0123456789abcdef")).toContain(
      "[secret]",
    );
    expect(redact("AKIAABCDEFGHIJKLMNOP")).toBe("[secret]");
    expect(redact("xoxb-1234567890-abc")).toBe("[secret]");
    expect(redact("x".repeat(45))).toBe("[redacted]");
    const url = redactPii("see https://x.io/d?token=supersecretvalue123");
    expect(url.text).toContain("[redacted]");
    expect(url.text).not.toContain("supersecretvalue123");
    expect(url.redacted).toEqual(["secret"]);
  });

  it("redacts messenger links and handles", () => {
    expect(redact("ping t.me/someone or @baumy_fan")).toBe(
      "ping [link] or [handle]",
    );
  });

  it("redacts a whole UUID, with no false [card] and no digits left", () => {
    for (const uuid of [
      "12345678-1234-1234-1234-123456789012",
      "3f2c9a1e-7b4d-4e8f-9c0a-1d2e3f4a5b6c",
    ]) {
      const out = redactPii(`member ${uuid} failed`);
      expect(out.text).toBe("member [uuid] failed");
      expect(out.redacted).toEqual(["uuid"]);
    }
  });

  it("removes a JSON object whole, nested contents included", () => {
    const out = redactPii(
      'render failed: {"name":"Alice Hatter","meta":{"note":"x"}} at row 3',
    );
    expect(out.text).toBe("render failed: [structured data removed] at row 3");
    expect(out.redacted).toEqual(["structured-data"]);
  });

  it("removes a JSON array of names", () => {
    expect(redact('house ["Alice Hatter","Bob Rabbit"] missing')).toBe(
      "house [structured data removed] missing",
    );
  });

  it("leaves an unbalanced bracket for the other rules", () => {
    expect(redact("{ oops jane@example.com")).toBe("{ oops [email]");
    expect(redact("[ oops")).toBe("[ oops");
  });

  it("keeps its own placeholders, and their kinds, on a second pass", () => {
    const once = redactPii('mail jane@example.com, Bearer abc123, {"a":1}');
    const twice = redactPii(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.redacted).toEqual(once.redacted);
  });

  it("finds nothing in plain text", () => {
    expect(redactPii("The log button does nothing.")).toEqual({
      text: "The log button does nothing.",
      redacted: [],
    });
  });

  // The limit the dialog and the issue footer both state: redaction matches
  // patterns, so a name passes straight through. This is why the issue never
  // carries a name we hold, only the opaque member id.
  it("cannot recognise a name: redaction can miss things", () => {
    const out = redactPii("Ryan's chore vanished after Anna logged it");
    expect(out.text).toContain("Anna");
    expect(out.redacted).toEqual([]);
  });
});

describe("sanitizeReportText", () => {
  it("strips HTML tags and trims", () => {
    expect(
      sanitizeReportText("  <script>alert(1)</script>hello  ", 100).text,
    ).toBe("alert(1)hello");
  });

  it("keeps an unterminated < and the text after it", () => {
    expect(sanitizeReportText("Expected count < 10, got NaN", 100).text).toBe(
      "Expected count < 10, got NaN",
    );
  });

  it("strips a long run of < in linear time", () => {
    const started = performance.now();
    sanitizeReportText("<".repeat(50_000), 100);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("caps length", () => {
    expect(sanitizeReportText("word ".repeat(50), 10).text).toHaveLength(10);
  });

  it("returns nothing found for empty input", () => {
    expect(sanitizeReportText("", 10)).toEqual({ text: "", redacted: [] });
  });
});

describe("describeRedactions", () => {
  it("names what was removed, and never claims the report is anonymous", () => {
    const note = describeRedactions(["phone", "email"]);
    expect(note).toContain("email addresses, phone numbers");
    expect(note).toContain("can miss things");
    expect(note.toLowerCase()).not.toContain("anonym");
  });

  it("says nothing was recognised, with the same caveat", () => {
    const note = describeRedactions([]);
    expect(note).toContain("No personal data was recognised");
    expect(note).toContain("can miss things");
  });
});
