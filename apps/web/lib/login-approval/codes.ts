import { LOGIN_CODE_MAX, LOGIN_CODE_MIN } from "@baumy/types";

// The number the sign-in screen shows, and the four decoys brain's DM shows
// beside it (issue #80). Tapping the number that is on the screen is the
// proof that the person holding the phone is looking at this browser, so a
// push they did not ask for cannot be approved by reflex.

/** A random integer in [min, max), as `crypto.randomInt` gives one. */
export type RandomInt = (min: number, max: number) => number;

/** The number on the screen and four decoys: a blind tap is right 1 time in 5. */
export const LOGIN_CHOICE_COUNT = 5;

/**
 * The code and the five choices in button order: distinct two-digit
 * numbers, with the code at a random place among them.
 */
export function pickLoginCodes(randomInt: RandomInt): {
  code: number;
  choices: number[];
} {
  const picked = new Set<number>();
  while (picked.size < LOGIN_CHOICE_COUNT) {
    picked.add(randomInt(LOGIN_CODE_MIN, LOGIN_CODE_MAX + 1));
  }
  const choices = [...picked];
  const code = choices[randomInt(0, LOGIN_CHOICE_COUNT)]!;
  return { code, choices: choices.sort((a, b) => a - b) };
}
