import { describe, expect, it } from "vitest";
import {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  COOLDOWN_HOURS_MAX,
  EFFORT_FACTOR_MAX,
  EFFORT_FACTOR_MIN,
} from "@baumy/types";
import {
  CHANGES_FIELD,
  COOLDOWN_STOPS,
  EFFORT_STOPS,
  POINT_STOPS,
  REQUIRED,
  blankErrors,
  changeOf,
  changesFromForm,
  changesOf,
  cooldownText,
  draftOf,
  effortText,
  pointsText,
  rowErrors,
  saveLabel,
  sliderValue,
  type BulkBounty,
} from "./bulk-edit";

// The mass bounty editor's pure half (issue #175).

const trash: BulkBounty = {
  id: "t",
  name: "Trash",
  kind: "maintenance",
  proofMode: "none",
  effortFactorPct: 100,
  basePoints: 20,
  cooldownMinutes: 90,
  archived: false,
};
const bare: BulkBounty = {
  ...trash,
  id: "b",
  name: "Bare",
  basePoints: null,
  cooldownMinutes: null,
};

describe("draftOf", () => {
  it("holds numbers as text, and nothing for a missing weight", () => {
    expect(draftOf(trash)).toEqual({
      name: "Trash",
      kind: "maintenance",
      points: "20",
      cooldownHours: "1.5",
      proofMode: "none",
      effortFactorPct: "100",
      archived: false,
    });
    expect(draftOf(bare)).toMatchObject({ points: "", cooldownHours: "" });
  });
});

describe("changeOf", () => {
  it("is null for an untouched draft, or one changed back", () => {
    expect(changeOf(trash, draftOf(trash))).toBeNull();
    expect(
      changeOf(trash, {
        ...draftOf(trash),
        name: " Trash ",
        points: "20.0",
        cooldownHours: "1.50",
        effortFactorPct: "100",
      }),
    ).toBeNull();
    expect(
      changeOf(bare, { ...draftOf(bare), points: " ", cooldownHours: "" }),
    ).toBeNull();
  });

  it("sends only the fields that differ, numbers as numbers", () => {
    expect(
      changeOf(trash, {
        name: "Bins",
        kind: "consumable",
        points: String(BASE_POINTS_MAX),
        cooldownHours: "2",
        proofMode: "required",
        effortFactorPct: "150",
        archived: true,
      }),
    ).toEqual({
      choreId: "t",
      name: "Bins",
      kind: "consumable",
      points: BASE_POINTS_MAX,
      cooldownHours: 2,
      proofMode: "required",
      effortFactorPct: 150,
      archived: true,
    });
    expect(changeOf(bare, { ...draftOf(bare), points: "5" })).toEqual({
      choreId: "b",
      points: 5,
    });
  });

  it("looks only at the fields the admin touched, never reverting another's change", () => {
    expect(changeOf(trash, {})).toBeNull();
    // Another admin made Trash a consumable after this page loaded; this
    // admin touched only its points, so only the points are sent.
    const refreshed: BulkBounty = { ...trash, kind: "consumable" };
    expect(changeOf(refreshed, { points: "5" })).toEqual({
      choreId: "t",
      points: 5,
    });
  });

  it("sends a cleared or non-number field as text, for the action to name", () => {
    expect(changeOf(trash, { ...draftOf(trash), points: "  " })).toEqual({
      choreId: "t",
      points: "",
    });
    expect(
      changeOf(trash, { ...draftOf(trash), effortFactorPct: "lots" }),
    ).toEqual({ choreId: "t", effortFactorPct: "lots" });
  });
});

describe("blankErrors", () => {
  it("says Required for a blank number the bounty must have", () => {
    expect(blankErrors(trash, { points: " ", effortFactorPct: "" })).toEqual({
      points: [REQUIRED],
      effortFactorPct: [REQUIRED],
    });
    expect(blankErrors(trash, { cooldownHours: "" })).toEqual({
      cooldownHours: [REQUIRED],
    });
    expect(blankErrors(trash, { points: "4" })).toEqual({});
    expect(blankErrors(trash, {})).toEqual({});
  });

  it("lets a bounty with no points stay without, unless half is given", () => {
    expect(blankErrors(bare, { points: "", cooldownHours: "" })).toEqual({});
    expect(blankErrors(bare, { points: "5" })).toEqual({
      cooldownHours: [REQUIRED],
    });
    expect(blankErrors(bare, { cooldownHours: "2", points: " " })).toEqual({
      points: [REQUIRED],
    });
  });
});

describe("changesOf", () => {
  it("lists the changed rows in the bounties' order", () => {
    expect(
      changesOf([trash, bare], {
        b: { ...draftOf(bare), name: "Bare 2" },
        t: { ...draftOf(trash), archived: true },
      }),
    ).toEqual([
      { choreId: "t", archived: true },
      { choreId: "b", name: "Bare 2" },
    ]);
    expect(changesOf([trash], { t: draftOf(trash) })).toEqual([]);
    expect(changesOf([trash], {})).toEqual([]);
  });
});

describe("changesFromForm", () => {
  it("parses the JSON field, and gives nothing for anything else", () => {
    expect(
      changesFromForm({ [CHANGES_FIELD]: '[{"choreId":"t","points":4}]' }),
    ).toEqual({ changes: [{ choreId: "t", points: 4 }] });
    expect(changesFromForm({ [CHANGES_FIELD]: "{not json" })).toEqual({});
    expect(changesFromForm({})).toEqual({});
    // Stray fields never reach the action.
    expect(changesFromForm({ [CHANGES_FIELD]: "[]", choreId: "x" })).toEqual({
      changes: [],
    });
  });
});

describe("rowErrors", () => {
  const sent = [{ choreId: "t" }, { choreId: "b" }];
  it("maps each issue onto its row and field", () => {
    expect(
      rowErrors(
        {
          ok: false,
          code: "INVALID_INPUT",
          message: "Some of that is not valid.",
          issues: [
            { path: ["changes", 1, "points"], message: "At least 1." },
            { path: ["changes", 1, "points"], message: "Whole number." },
            { path: ["changes", 0, "name"], message: "Give it a name." },
            // Not about a field, or not about a row: left out.
            { path: ["changes", 0, "choreId"], message: "Twice." },
            { path: ["changes", 7, "name"], message: "No such row." },
            { path: ["changes"], message: "At least one." },
            { path: ["requestId"], message: "Needed." },
          ],
        },
        sent,
      ),
    ).toEqual({
      t: { name: ["Give it a name."] },
      b: { points: ["At least 1.", "Whole number."] },
    });
  });

  it("is empty for no answer, a success or a failure with no issues", () => {
    expect(rowErrors(null, sent)).toEqual({});
    expect(rowErrors({ ok: true, data: null }, sent)).toEqual({});
    expect(
      rowErrors({ ok: false, code: "NOT_FOUND", message: "Gone." }, sent),
    ).toEqual({});
  });
});

describe("saveLabel", () => {
  it("counts the changes", () => {
    expect(saveLabel(0)).toBe("Save changes");
    expect(saveLabel(1)).toBe("Save 1 change");
    expect(saveLabel(3)).toBe("Save 3 changes");
  });
});

describe("the sliders (issue #179)", () => {
  it("spans each field's limits", () => {
    expect(POINT_STOPS[0]).toBe(BASE_POINTS_MIN);
    expect(POINT_STOPS.at(-1)).toBe(BASE_POINTS_MAX);
    expect(POINT_STOPS).toHaveLength(BASE_POINTS_MAX - BASE_POINTS_MIN + 1);
    expect(EFFORT_STOPS[0]).toBe(EFFORT_FACTOR_MIN);
    expect(EFFORT_STOPS.at(-1)).toBe(EFFORT_FACTOR_MAX);
    expect(EFFORT_STOPS).toContain(100);
    expect(COOLDOWN_STOPS[0]).toBe(0);
    expect(COOLDOWN_STOPS.at(-1)).toBe(COOLDOWN_HOURS_MAX);
  });

  it("puts the common cooldowns on the scale, in order, once each", () => {
    for (const h of [1, 6, 12, 24, 48, 72, 84, 168, 336, 720]) {
      expect(COOLDOWN_STOPS).toContain(h);
    }
    expect(COOLDOWN_STOPS).toEqual(
      [...new Set(COOLDOWN_STOPS)].sort((a, b) => a - b),
    );
    expect(COOLDOWN_STOPS).toHaveLength(72);
  });

  it("says each value with its unit", () => {
    expect(pointsText(1)).toBe("1 pt");
    expect(pointsText(26)).toBe("26 pts");
    expect(effortText(100)).toBe("100%");
    expect(cooldownText(0)).toBe("0 h");
    expect(cooldownText(1.5)).toBe("1.5 h");
    expect(cooldownText(24)).toBe("24 h · 1 day");
    expect(cooldownText(84)).toBe("84 h · 3.5 days");
  });

  it("reads a draft's number, or none", () => {
    expect(sliderValue("26")).toBe(26);
    expect(sliderValue(" 1.5 ")).toBe(1.5);
    expect(sliderValue("")).toBeNull();
    expect(sliderValue("x")).toBeNull();
  });
});
