// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toolSpecs } from "@/lib/actions/tool-specs";
import { renderOperationsSpec, SPEC_PATH } from "./operations-spec";
import { BRAIN_ACTION_NOTES } from "./operations-spec-notes";

// docs/brain-operations-spec.md is generated from the registry (issue #70).
// This fails while the committed doc differs from what the registry, the
// template and the notes produce now; `pnpm brain:spec` rewrites it.

const template = readFileSync(
  path.join(import.meta.dirname, "operations-spec.template.md"),
  "utf8",
);
const repoRoot = path.resolve(import.meta.dirname, "../../../..");

describe("the brain operations spec", () => {
  it("is up to date with the action registry (run `pnpm brain:spec`)", async () => {
    const doc = renderOperationsSpec(template);
    expect(doc).toContain("### `log_completion`: Log a chore");
    await expect(doc).toMatchFileSnapshot(path.join(repoRoot, SPEC_PATH));
  });

  it("has notes for exactly the actions brain is offered", () => {
    const names = toolSpecs("brain").map((s) => s.name);
    expect(names).toContain("delete_note");
    expect(Object.keys(BRAIN_ACTION_NOTES).sort()).toEqual([...names].sort());
  });

  it("documents each action's gate, confirm rule, on-behalf rule and errors", () => {
    const doc = renderOperationsSpec(template);
    const section = (name: string) => {
      const start = doc.indexOf(`### \`${name}\``);
      expect(start).toBeGreaterThan(-1);
      const end = doc.indexOf("\n### ", start + 1);
      return doc.slice(start, end === -1 ? undefined : end);
    };
    expect(section("delete_event")).toContain(
      "`destructive`: always send `X-Baumy-Confirmed: 1`",
    );
    expect(section("delete_event")).toContain("Calls out");
    expect(section("acknowledge_reminder")).toContain(
      "on a housemate's behalf it needs `X-Baumy-Confirmed: 1`",
    );
    expect(section("log_completion")).toContain(
      "no (400): name the housemate in `doneBy` instead",
    );
    expect(section("log_completion")).toContain("`COOLDOWN` (422)");
    for (const name of ["create_note", "update_note", "delete_note"]) {
      expect(section(name), name).toContain(
        "yes, with `X-Baumy-On-Behalf-Of` and the asker's confirm tap",
      );
    }
    for (const name of [
      "confirm_completion",
      "dispute_completion",
      "undo_completion",
      "withdraw_dispute",
      "concede_completion",
    ]) {
      expect(section(name), name).toContain(
        "no (403 `FORBIDDEN`): only the member themself may",
      );
    }
    expect(section("acknowledge_reminder")).toContain(
      "yes, with `X-Baumy-On-Behalf-Of` and the asker's confirm tap",
    );
    expect(section("link_telegram")).toContain(
      "linking is always for the sender",
    );
    expect(section("list_events")).toContain(
      "runs straight away, on anyone's behalf too",
    );
    // The unavailable list names admin, account and excluded actions.
    const tail = doc.slice(doc.indexOf("## 8. Not available to Baumy"));
    expect(tail).toContain("`manage_members`: An admin action");
    expect(tail).toContain("`update_my_profile`: The member's own account");
    expect(tail).toContain("`attach_completion_photo`: A proof photo");
    expect(tail).not.toContain("`delete_note`");
  });

  it("refuses a template without its markers", () => {
    expect(() => renderOperationsSpec("# nothing here")).toThrow(/missing/);
  });
});
