import type { AvatarImage } from "@baumy/types";
import { UNSAFE_PATH, photoProxyUrl } from "@/lib/photos/paths";

// Where gallery sprites live in Blob and how the app links to them (issue
// #111). Pure and client-safe, like lib/photos/paths.ts, whose proxy serves
// both: a sprite is `avatars/{avatarId}/{rand}.png` in the same PRIVATE
// store, and the client only ever sees `/api/blob?pathname=…`.

/**
 * The most an uploaded image may weigh: under Vercel's 4.5 MB request body
 * cap. It is not downscaled in the browser first (that would smear the
 * pixels), so this is the file as the owner saved it.
 */
export const AVATAR_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The only sprite pathnames there are: always a cleaned PNG. */
const AVATAR_PATH = new RegExp(`^avatars/(${UUID})/[A-Za-z0-9_-]{8,64}\\.png$`);

/**
 * The gallery sprite a pathname belongs to, or null when the pathname is
 * unsafe or not on the allow-list.
 */
export function avatarPathAvatarId(pathname: string): string | null {
  if (UNSAFE_PATH.test(pathname)) return null;
  return AVATAR_PATH.exec(pathname)?.[1] ?? null;
}

/** The pathname for a new sprite. */
export function avatarPathname(avatarId: string, rand: string): string {
  return `avatars/${avatarId}/${rand}.png`;
}

/** A stored sprite as the screens draw it: through the proxy only. */
export function avatarImageView(
  ref: { pathname: string; width: number; height: number } | null,
): AvatarImage | null {
  return ref
    ? { src: photoProxyUrl(ref.pathname), width: ref.width, height: ref.height }
    : null;
}
