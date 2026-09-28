// Baumy (ADR 0005 §7): Camp 404's INKBLOT cat (inkblot-cat.ts) with twice
// the pixels. Every frame goes through Scale2x, which turns each pixel into
// four and rounds the stair-step edges, so the cat keeps its shape but gains
// detail. Only the colours change, to match design/baumy-reference.png.
// Ported from the approved prototype (proto/kiosk-home-pixel,
// baumy-cat-2x.ts). Never draw a different cat.

import { CAT_FRAMES, CAT_H, CAT_W } from "./inkblot-cat";
import type { Palette } from "./pixel-grid";
import { scale2x } from "./scale2x";

export const BAUMY_W = CAT_W * 2;
export const BAUMY_H = CAT_H * 2;

export type BaumyAnimation = keyof typeof CAT_FRAMES;

/** Every animation of the cat, each frame through Scale2x. */
export const BAUMY_FRAMES = Object.fromEntries(
  Object.entries(CAT_FRAMES).map(([k, frames]) => [k, frames.map(scale2x)]),
) as Record<BaumyAnimation, string[][]>;

/** Baumy's colours from the reference photo (camp-404 used K, D, O, E). */
export const BAUMY_COLOURS: Palette = {
  K: "#1f1830", // the coat: soft black with a violet cast
  D: "#4a3a6a", // the fluffy violet sheen the fairy lights put on the fur
  O: "#0a0710", // outline
  E: "#43f0a0", // the green eye
};
