// Where completion photos live in Blob and how the app links to them (SPEC
// §6.5). Pure and client-safe: the upload route, the proxy and the pages all
// agree on these through this one file.
//
// A photo is stored at `completions/{completionId}/{rand}.{ext}` in a PRIVATE
// store. The client only ever sees `/api/blob?pathname=…`, never a raw Blob
// URL, and the proxy serves only pathnames of that exact shape.

/** What a photo may be. No SVG: the proxy serves same-origin. */
export const PHOTO_TYPES = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;

export type PhotoType = keyof typeof PHOTO_TYPES;

/** 5 MB. The client downscales to 1280px first, so a real photo is far less. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** The longest edge the client downscales a photo to. */
export const PHOTO_MAX_EDGE_PX = 1280;

export function isPhotoType(type: string): type is PhotoType {
  return Object.hasOwn(PHOTO_TYPES, type);
}

/**
 * camp-404's `UNSAFE_PATH` (`apps/web/app/api/avatar/route.ts`): a `.` or
 * `..` segment, an empty segment, a backslash or any escape. The blob client
 * builds a URL from the pathname, so any of these could be resolved into
 * another folder and slip past the ownership check.
 */
export const UNSAFE_PATH = /(^|\/)\.{1,2}(\/|$)|\/\/|\\|%/;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The only pathnames there are: one completion's folder, one plain file. */
const PHOTO_PATH = new RegExp(
  `^completions/(${UUID})/[A-Za-z0-9_-]{8,64}\\.(webp|jpg|png)$`,
);

/**
 * The completion a photo pathname belongs to, or null when the pathname is
 * unsafe or not on the allow-list.
 */
export function photoPathCompletionId(pathname: string): string | null {
  if (UNSAFE_PATH.test(pathname)) return null;
  return PHOTO_PATH.exec(pathname)?.[1] ?? null;
}

/** The pathname for a new photo of `completionId`. */
export function photoPathname(
  completionId: string,
  type: PhotoType,
  rand: string,
): string {
  return `completions/${completionId}/${rand}.${PHOTO_TYPES[type]}`;
}

/** The only link to a photo the client ever gets: through the proxy. */
export function photoProxyUrl(pathname: string): string {
  return `/api/blob?pathname=${encodeURIComponent(pathname)}`;
}
