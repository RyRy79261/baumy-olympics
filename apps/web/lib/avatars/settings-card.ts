// What Settings' "Your character" shows (issues #111, #116): the gallery
// form when there is a live character to pick, or when the member still
// wears an archived one (so they see it and can take it off); otherwise
// only their initial tile.

export function showsGalleryForm<
  T extends { id: string; archivedAt: Date | null },
>(
  gallery: readonly T[],
  wornId: string | null | undefined,
): { show: boolean; live: T[]; worn: T | undefined } {
  const live = gallery.filter((a) => a.archivedAt === null);
  const worn = wornId ? gallery.find((a) => a.id === wornId) : undefined;
  return { show: live.length > 0 || worn !== undefined, live, worn };
}
