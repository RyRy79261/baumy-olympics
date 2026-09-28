import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LOGIN_CODE_MAX, LOGIN_CODE_MIN } from "@baumy/types";
import { LOGIN_CHOICE_COUNT, pickLoginCodes, type RandomInt } from "./codes";

// The number on the screen and its two decoys (issue #80).

describe("pickLoginCodes", () => {
  it("gives five distinct two-digit numbers, one of them the code", () => {
    for (let i = 0; i < 500; i++) {
      const { code, choices } = pickLoginCodes(randomInt);
      expect(choices).toHaveLength(LOGIN_CHOICE_COUNT);
      expect(new Set(choices).size).toBe(LOGIN_CHOICE_COUNT);
      expect(choices).toContain(code);
      for (const n of choices) {
        expect(n).toBeGreaterThanOrEqual(LOGIN_CODE_MIN);
        expect(n).toBeLessThanOrEqual(LOGIN_CODE_MAX);
      }
      expect([...choices].sort((a, b) => a - b)).toEqual(choices);
    }
  });

  it("draws again on a repeat, and lets the draw pick the code's place", () => {
    const draws = [47, 47, 12, 83, 30, 65, 2];
    const scripted: RandomInt = () => draws.shift()!;
    // 47 twice, then 12, 83, 30 and 65; the code is the third drawn (83).
    expect(pickLoginCodes(scripted)).toEqual({
      code: 83,
      choices: [12, 30, 47, 65, 83],
    });
  });

  it("asks for the whole two-digit range", () => {
    const asked: [number, number][] = [];
    let n = 10;
    pickLoginCodes((min, max) => {
      asked.push([min, max]);
      return min === 0 ? 0 : n++;
    });
    expect(asked[0]).toEqual([LOGIN_CODE_MIN, LOGIN_CODE_MAX + 1]);
    expect(asked.at(-1)).toEqual([0, LOGIN_CHOICE_COUNT]);
  });
});
