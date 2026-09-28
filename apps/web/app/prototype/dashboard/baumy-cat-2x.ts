// PROTOTYPE (issue #7), throwaway. Camp 404's INKBLOT cat (inkblot-cat.ts)
// with twice the pixels: each frame goes through Scale2x (EPX), the pixel-art
// upscaler that turns every pixel into four and rounds the stair-step edges,
// so the cat keeps its shape but gains detail. Only the colours change, to
// match design/baumy-reference.png.

import { CAT_FRAMES, CAT_H, CAT_W } from "./inkblot-cat";

type Sprite = readonly string[];

function scale2x(src: Sprite): string[] {
  const h = src.length;
  const w = src[0]!.length;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? "." : src[y]![x]!);
  const out: string[][] = Array.from({ length: h * 2 }, () => Array<string>(w * 2).fill("."));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      out[y * 2]![x * 2] = c === a && c !== d && a !== b ? a : p;
      out[y * 2]![x * 2 + 1] = a === b && a !== c && b !== d ? b : p;
      out[y * 2 + 1]![x * 2] = d === c && d !== b && c !== a ? c : p;
      out[y * 2 + 1]![x * 2 + 1] = b === d && b !== a && d !== c ? d : p;
    }
  }
  return out.map((r) => r.join(""));
}

export const BAUMY_W = CAT_W * 2;
export const BAUMY_H = CAT_H * 2;

export const BAUMY_FRAMES = Object.fromEntries(
  Object.entries(CAT_FRAMES).map(([k, frames]) => [k, frames.map(scale2x)]),
) as Record<keyof typeof CAT_FRAMES, string[][]>;

/** Baumy's colours from the reference photo (camp-404 used K, D, O, E). */
export const BAUMY_COLOURS: Record<string, string> = {
  K: "#1f1830", // the coat: soft black with a violet cast
  D: "#4a3a6a", // the fluffy violet sheen the fairy lights put on the fur
  O: "#0a0710", // outline
  E: "#43f0a0", // the green eye
};
