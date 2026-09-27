import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeFields, humanize } from "./proposal";

// The editable fields of a proposal come from the tool's own JSON Schema.

const choices = {
  members: [{ value: "m1", label: "Ryan" }],
  chores: [{ value: "c1", label: "Trash" }],
};

describe("describeFields", () => {
  it("turns each property into a field the sheet can edit", () => {
    const schema = z.toJSONSchema(
      z.strictObject({
        choreId: z.uuid(),
        doneBy: z.uuid().optional(),
        memberId: z.uuid().optional(),
        completionId: z.uuid(),
        kind: z.enum(["timed", "all_day"]),
        pinned: z.boolean().optional(),
        points: z.number().int(),
        title: z.string().max(80),
        bodyMd: z.string().max(4000).optional(),
        description: z.string().optional(),
        notes: z.string().max(500),
        tags: z.array(z.string()).optional(),
      }),
      { io: "input" },
    ) as Record<string, unknown>;
    expect(describeFields(schema, choices)).toEqual([
      {
        name: "choreId",
        label: "Chore",
        required: true,
        kind: "select",
        options: choices.chores,
      },
      {
        name: "doneBy",
        label: "Done by",
        required: false,
        kind: "select",
        options: choices.members,
      },
      {
        name: "memberId",
        label: "Member",
        required: false,
        kind: "select",
        options: choices.members,
      },
      {
        name: "completionId",
        label: "Completion",
        required: true,
        kind: "readonly",
      },
      {
        name: "kind",
        label: "Kind",
        required: true,
        kind: "select",
        options: [
          { value: "timed", label: "Timed" },
          { value: "all_day", label: "All day" },
        ],
      },
      { name: "pinned", label: "Pinned", required: false, kind: "boolean" },
      { name: "points", label: "Points", required: true, kind: "number" },
      { name: "title", label: "Title", required: true, kind: "text" },
      { name: "bodyMd", label: "Text", required: false, kind: "textarea" },
      {
        name: "description",
        label: "Description",
        required: false,
        kind: "textarea",
      },
      { name: "notes", label: "Notes", required: true, kind: "textarea" },
      { name: "tags", label: "Tags", required: false, kind: "readonly" },
    ]);
  });

  it("has no fields for a schema without properties", () => {
    expect(describeFields({ type: "object" }, choices)).toEqual([]);
  });
});

describe("humanize", () => {
  it("reads camelCase and snake_case as words", () => {
    expect(humanize("occurredAt")).toBe("Occurred at");
    expect(humanize("all_day")).toBe("All day");
    expect(humanize("")).toBe("");
  });
});
