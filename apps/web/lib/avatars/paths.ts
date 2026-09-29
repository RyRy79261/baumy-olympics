import type { AvatarImage, AvatarPose, AvatarSprites } from "@baumy/types";
import { UNSAFE_PATH, photoProxyUrl } from "@/lib/photos/paths";

// Where gallery sprites live in Blob and how the app links to them (issue
// #111). Pure and client-safe, like lib/photos/paths.ts, whose proxy serves
// both: each pose of a set is `avatars/{avatarId}/{rand}.png` in the same
// PRIVATE store, and the client only ever sees `/api/blob?pathname=…`.

/**
 * The most one upload (every file of a set together) may weigh: under
 * Vercel's 4.5 MB request body cap. Files are not downscaled in the browser
 * first (that would smear the pixels), so these are the files as saved.
 */
export const AVATAR_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The only sprite pathnames there are: always a cleaned PNG. */
const AVATAR_PATH = new RegExp(`^avatars/(${UUID})/[A-Za-z0-9_-]{8,64}\\.png$`);

/**
 * The gallery set a pathname belongs to, or null when the pathname is
 * unsafe or not on the allow-list.
 */
export function avatarPathAvatarId(pathname: string): string | null {
  if (UNSAFE_PATH.test(pathname)) return null;
  return AVATAR_PATH.exec(pathname)?.[1] ?? null;
}

/** The pathname for a new pose of a set. */
export function avatarPathname(avatarId: string, rand: string): string {
  return `avatars/${avatarId}/${rand}.png`;
}

interface PoseLike {
  pathname: string;
  width: number;
  height: number;
}

/** One stored pose as a screen draws it: through the proxy only. */
export function poseView(p: PoseLike): AvatarImage {
  return { src: photoProxyUrl(p.pathname), width: p.width, height: p.height };
}

/** A stored set as the screens draw it, or null for none. */
export function avatarImageView(
  ref: {
    poses: { idle: PoseLike } & Partial<Record<AvatarPose, PoseLike>>;
  } | null,
): AvatarSprites | null {
  if (!ref) return null;
  const { idle, walk, emote } = ref.poses;
  return {
    idle: poseView(idle),
    walk: walk ? poseView(walk) : null,
    emote: emote ? poseView(emote) : null,
  };
}
