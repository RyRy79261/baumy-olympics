import { SpriteStrip } from "./pixel/pixel-art";
import type { Palette, Sprite } from "./pixel/pixel-grid";

// The screensaver's raccoons (ADR 0005 §6; issue #191). Four poses, all
// facing right, drawn from the owner's reference photos and approved by the
// owner on 2026-10-11 ("Perfect"). The grids are the approved ones,
// character for character: never redraw, retouch or recolour them (the
// owner's rule is that we never hand-draw art; these were the one approved
// exception). The walker and the carrier have two frames that differ only
// in the legs; the reacher and the sitter stand still. Where they go is the
// screensaver's business.

/** Walking, frame 1. */
const WALK_0: Sprite = [
  "..........................................",
  "..........................................",
  "............................KKK.....KKK...",
  "..............KKKKKKKKKK...KWGWK...KWGWK..",
  ".............KGGGGGGGGGGK..KgGgKKKKKgGgK..",
  ".......KKKKKKGGGGGGGGGGGGKKKgggggGgggggK..",
  ".....KKMlMMGGGGGGGGGGGGGGGGKWWWWgGgWWWWK..",
  "...KKlMMlMMGGGGGGGGGGGGGGggKMMMMWGWMMMMK..",
  "..KlMlMMlMGGGGGGGGGGGGGGGgKWMeMMMGMMMeMWK.",
  ".KllMllMlMggggggggggggggggKWWMMMMGMMMMWWK.",
  "KMlllMlMlMggggggggggggggggggKWMMWGWMMWK...",
  "KMMMlMllMMgggggggggggggggggggKWWWGWWWK....",
  "lllMMMMKKKKgggggggggggggggggggKWWMWWK.....",
  "MMlllMK...KggggggggggggggggggggKKKKK......",
  "MMMMlK.....KKgggggggggllllgggggggK........",
  "MMMMMK......KKgggggllllllllllgggK.........",
  "MMMMK......KGGGGKKddddKKKGGggddK..........",
  "KMMK.......KGGGK.KdddK..KGGKKKddK.........",
  ".KK.........KGGKKdddK...KGGK.KddK.........",
  "............KGGKKddK....KGGK..KddK........",
  "............KGGKKddK....KGGK..KddK........",
  "...........KMMMMKMMMK...KMMMK.KMMMK.......",
  "............KKKK.KKK.....KKK...KKK........",
];

/** Walking, frame 2: only the legs move. */
const WALK_1: Sprite = [
  "..........................................",
  "..........................................",
  "............................KKK.....KKK...",
  "..............KKKKKKKKKK...KWGWK...KWGWK..",
  ".............KGGGGGGGGGGK..KgGgKKKKKgGgK..",
  ".......KKKKKKGGGGGGGGGGGGKKKgggggGgggggK..",
  ".....KKMlMMGGGGGGGGGGGGGGGGKWWWWgGgWWWWK..",
  "...KKlMMlMMGGGGGGGGGGGGGGggKMMMMWGWMMMMK..",
  "..KlMlMMlMGGGGGGGGGGGGGGGgKWMeMMMGMMMeMWK.",
  ".KllMllMlMggggggggggggggggKWWMMMMGMMMMWWK.",
  "KMlllMlMlMggggggggggggggggggKWMMWGWMMWK...",
  "KMMMlMllMMgggggggggggggggggggKWWWGWWWK....",
  "lllMMMMKKKKgggggggggggggggggggKWWMWWK.....",
  "MMlllMK...KggggggggggggggggggggKKKKK......",
  "MMMMlK.....KKgggggggggllllgggggggK........",
  "MMMMMK.......KgggggllllllllllgggK.........",
  "MMMMK.......KGGGGddddKKKKGGggddK..........",
  "KMMK........KGGGKdddK....KGGKddK..........",
  ".KK........KGGGK.KddK....KGGKddK..........",
  "...........KGGK..KddK.....KGGddK..........",
  "...........KGGK..KddK.....KGGddK..........",
  "...........KMMMKKMMMMK....KMMMMMK.........",
  "............KKK..KKKK......KKKKK..........",
];

/** On its hind legs with a jar, frame 1. */
const CARRY_0: Sprite = [
  "..........................................",
  "..........................................",
  ".....................KKK.....KKK..........",
  "....................KWGWK...KWGWK.........",
  "....................KgGgKKKKKgGgK.........",
  "....................KgggggGgggggK.........",
  "....................KWWWWgGgWWWWK.........",
  "....................KMMMMWGWMMMMK.........",
  "...................KWMeMMMGMMMeMWK........",
  "...................KWWMMMMGMMMMWWK........",
  "....................KKWMMWGWMMWK..........",
  "...................KGGKWWWGWWWK...........",
  "..................KGGGgKWWMWWK............",
  ".................KKGGgggKKKKKgK...........",
  "................KGGGggggGGggggK...........",
  "...............KGGGggggGGGGgggK...........",
  "..............KGGGgggggGGGGggK.KKKKKK.....",
  ".............KKGGGggggggGGGGgKKRRRRRRK....",
  "............KGGGGggggggglGGGGKKKKKKKKK....",
  "...........KGGGGggggggllllGGGGKooooooK....",
  "..........KGGGGgggggglllllGGGMMooOOooMM...",
  ".......KKKKGGGGggggggllllgdGGMMooOOooMM...",
  ".....KKMMlGGGGgggggglllllgKKdGKooooooK....",
  "...KKMlMMlGGGgggggggllllgK..KdKooooooK....",
  "..KllMllMlGGggggggggllggK....KKKKKKKK.....",
  ".KMMlMMlMlGgggggggggggggK.................",
  "KlMMllMllllggggggggggggK..................",
  "MllMMlMMlKKggGGGGggggggK..................",
  "MMMllllKK..KggGGGGggggK...................",
  "MMMMllK.....KggGGGgggK....................",
  "MMMMMK.......KKKGGKKK.....................",
  "MMMMK..........KGGK.......................",
  "KMMK...........KGGKK......................",
  ".KK............KMMMMK.....................",
  "................KKKK......................",
  "..........................................",
];

/** On its hind legs with a jar, frame 2: only the legs move. */
const CARRY_1: Sprite = [
  "..........................................",
  "..........................................",
  ".....................KKK.....KKK..........",
  "....................KWGWK...KWGWK.........",
  "....................KgGgKKKKKgGgK.........",
  "....................KgggggGgggggK.........",
  "....................KWWWWgGgWWWWK.........",
  "....................KMMMMWGWMMMMK.........",
  "...................KWMeMMMGMMMeMWK........",
  "...................KWWMMMMGMMMMWWK........",
  "....................KKWMMWGWMMWK..........",
  "...................KGGKWWWGWWWK...........",
  "..................KGGGgKWWMWWK............",
  ".................KKGGgggKKKKKgK...........",
  "................KGGGggggGGggggK...........",
  "...............KGGGggggGGGGgggK...........",
  "..............KGGGgggggGGGGggK.KKKKKK.....",
  ".............KKGGGggggggGGGGgKKRRRRRRK....",
  "............KGGGGggggggglGGGGKKKKKKKKK....",
  "...........KGGGGggggggllllGGGGKooooooK....",
  "..........KGGGGgggggglllllGGGMMooOOooMM...",
  ".......KKKKGGGGggggggllllgdGGMMooOOooMM...",
  ".....KKMMlGGGGgggggglllllgKKdGKooooooK....",
  "...KKMlMMlGGGgggggggllllgK..KdKooooooK....",
  "..KllMllMlGGggggggggllggK....KKKKKKKK.....",
  ".KMMlMMlMlGgggggggggggggK.................",
  "KlMMllMllllggggggggggggK..................",
  "MllMMlMMlKKggggGGGGggggK..................",
  "MMMllllKK..KggGGGGggggK...................",
  "MMMMllK.....KGGGgggggK....................",
  "MMMMMK......KGGKKKKddK....................",
  "MMMMK.......KGGK..KddK....................",
  "KMMK........KGGKK.KddKK...................",
  ".KK.........KMMMMKKMMMMK..................",
  ".............KKKK..KKKK...................",
  "..........................................",
];

/** Standing, reaching up with both arms. */
const REACH: Sprite = [
  "..K.K.K...............K.K.K...",
  "..KMKMKM..............KMKMKM..",
  "..KMMMMK..............KMMMMK..",
  "..KKMMKK..............KKMMKK..",
  "..KGGGGK..............KGGGGK..",
  "..KGGGGGK.KKK.....KKKKGGGGGK..",
  "..KGGGGGKKWGWK...KWGWKGGGGGK..",
  "...KGGGGKKgGgKKKKKgGgKGGGGK...",
  "...KGGGGGKgggggGgggggKGGGGK...",
  "...KGGGGGKWWWWgGgWWWWKGGGGK...",
  "....KGGGGKMMMMWGWMMMMKGGGK....",
  "....KGGGKWMeMMMGMMMeMWKGGK....",
  ".....KGGKWWMMMMGMMMMWWKGK.....",
  ".....KGGGGKWMMWGWMMWKGGGK.....",
  "......KGGggKWWWGWWWKgGGK......",
  "......KGggggKWWMWWKgggGK......",
  ".......KgggggKKKKKggggK.......",
  ".......KggggggggggggggK.......",
  ".......KggggggggggggggK...KKKK",
  ".......KggggggggggggggK..KMMMM",
  ".......KggggggggggggggK..KMMMM",
  ".......KgggggllllgggggK..KMMMM",
  ".......KggggllllllggggK..KMMMM",
  "......KggggllllllllggggK.Kllll",
  "......KggggllllllllggggK.KMMMM",
  "......KggggllllllllggggKKMllll",
  "......KggggllllllllggggKKMMMll",
  "......KggggllllllllggggKlllMMl",
  ".......KgggllllllllgggMlMMllMK",
  ".......KggggllllllggggMMlMMlK.",
  "........KggggllllgggglMMllMMK.",
  ".........KKggggggggllllMlllK..",
  "........KGGGGKKKKGGGGllMlKK...",
  "........KGGGGK..KGGGGKKKK.....",
  ".........KKKK....KKKK.........",
  "..............................",
];

/** Sitting, from the front, tail curled. */
const SIT: Sprite = [
  "..............................",
  "..............................",
  "..............................",
  ".........KKK.....KKK..........",
  "........KWGWK...KWGWK.........",
  "........KgGgKKKKKgGgK.........",
  "........KgggggGgggggK.........",
  "........KWWWWgGgWWWWK.........",
  "........KMMMMWGWMMMMK.........",
  ".......KWMeMMMGMMMeMWK........",
  ".......KWWMMMMGMMMMWWK........",
  ".........KWMMWGWMMWK..........",
  "........KgKWWWGWWWKK..........",
  ".......KgggKWWMWWKggK.........",
  "......KGggggKKKKKggggK..KKKK..",
  "......KGgggggggggggggK.KMMMMK.",
  "......KGgggggggggggggK.KMMMMK.",
  "......KGgggggggggggggK.KMMMMK.",
  ".......KggggggggggggK..KMMMllK",
  "......KGggggllllgggggK.KlllMMK",
  ".....KGGggllllllllgggGK.KMMMMK",
  ".....KGGggllllllllgggGKKMllllK",
  ".....KGGggllllllllgggGKKMMMllK",
  ".....KGGggllllllllgggGllllMMK.",
  ".....KGGgglGGllGGlgggGllMlllK.",
  "......KGgglGGllGGlgggMMlMMMK..",
  ".......KgggGGllGGggglMMlMMMK..",
  ".......KGGGGGggGGGGGllMlKKK...",
  "......KGGGGGGKKGGGGGGKKK......",
  ".......KGGGGK..KGGGGK.........",
];

/** The approved colours, exactly. Any character not named here is clear. */
export const RACCOON_PALETTE: Palette = {
  K: "#07040c",
  G: "#3b3448",
  g: "#7d7590",
  l: "#a9a2bb",
  W: "#e8e3f0",
  M: "#15101d",
  e: "#ffe46b",
  R: "#d23b3b",
  o: "#c27a45",
  O: "#8f5530",
  d: "#28212f",
};

export type RaccoonPose = "walk" | "carry" | "reach" | "sit";

/** Each pose's frames, all of one size within a pose. */
export const RACCOON_POSES: Readonly<Record<RaccoonPose, readonly Sprite[]>> = {
  /** Side view, trotting: 42 × 23. */
  walk: [WALK_0, WALK_1],
  /** On its hind legs, body at about 45°, a jar in both arms: 42 × 36. */
  carry: [CARRY_0, CARRY_1],
  /** Standing, arms up: 30 × 36. */
  reach: [REACH],
  /** Front view, tail curled: 30 × 30. */
  sit: [SIT],
};

/** How long each frame shows: the carrier, upright, steps slower. */
const FRAME_MS: Record<RaccoonPose, number> = {
  walk: 200,
  carry: 300,
  reach: 450,
  sit: 450,
};

/** A raccoon in one pose, in place; `flip` faces it left. */
export function Raccoon({
  pose = "walk",
  scale = 4,
  flip = false,
  className,
}: {
  pose?: RaccoonPose;
  scale?: number;
  flip?: boolean;
  className?: string;
}) {
  return (
    <span data-pose={pose} className="contents">
      <SpriteStrip
        frames={RACCOON_POSES[pose]}
        palette={RACCOON_PALETTE}
        scale={scale}
        frameMs={FRAME_MS[pose]}
        flip={flip}
        className={className}
      />
    </span>
  );
}
