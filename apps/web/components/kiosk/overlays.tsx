// Where whatever covers the whole kitchen screen mounts (ADR 0005 §4, §6):
// the kiosk shell renders this last, over the page, the footer nav and
// Baumy. Issue #66 puts the full-screen reminder and the screensaver here
// (and may read what they need on the server first); until then it shows
// nothing. The night screen (components/kiosk/night-mode.tsx) is still
// mounted by the shell beside it.

export function KioskOverlays() {
  return null;
}
