import re

p = "docs/SPEC.md"
s = open(p).read()
a = s.index("**Avatar gallery** (added 2026-09-29")
b = s.index("### 6.4 Google Calendar")
s = s[:a] + '''**Avatar gallery** (added 2026-09-29, issue #111; owner rulings 2026-09-29: pre-generated avatars to select from, "integrated and uniform"; each character is a SET of three poses):

- Tables `avatars` (the set: `household_id`, `name`, `created_by`, `created_at`, `archived_at null`) and `avatar_poses` (`avatar_id`, `pose` `idle|walk|emote`, `pathname` unique, `width`, `height`; one row per pose, idle required), and `members.avatar_image_id null` (FK to the set). Rows are never deleted; archiving hides a set from the gallery and leaves it on whoever already wears it.
- The owner generates each set elsewhere with one shared style prompt (docs/SETUP.md, "Avatar gallery"): idle (standing, three-quarter), walk and emote side by side on one image; a set with only idle works. The app never draws. `POST /api/uploads/avatar` (multipart `image` (one sheet, or one file per pose, at most three), `height` 48/56/64 (default 64), `mode=preview|save`, `poses`, `name`, `requestId`; Origin check; 60 per member and 120 per IP an hour; PNG, JPEG or WebP, 4 MB together, the bytes sniffed, no SVG) runs `preview_avatar` `{height}` (read, `admin`, UI only), which cleans the files (`lib/avatars/clean.ts`, sharp): the background's colours are read from each image's border, with a tolerance from their own spread (so a JPEG's noisy black backdrop goes and the character's dark hair and coat stay), and flood-filled from the edges only (a painted checkerboard's seams and enclosed checkerboard patches too); the figures are the large shapes, left to right, with whatever overlaps each (a corner watermark goes); every figure of the set is sampled at ONE scale (the tallest to the height asked, or back to the art's own grid when it is an exact blow-up), each output pixel the commonest colour of the middle of its cell, a dark colour winning when a third of it is dark (thin outlines stay), then one palette of 24 colours (median cut) for the whole set, alpha all-or-nothing. A preview answers the figures as data URLs and keeps nothing; a save assigns them to poses (`poses`, left to right by default, the admin may reorder or skip; exactly one idle), stores only the cleaned PNGs at `avatars/{setId}/{rand}.png` and runs `add_avatar` `{name}` (write, `admin`, UI only, audited) with them in `ctx.avatarImage`, deleting the files again if that refuses.
- `archive_avatar`, `restore_avatar` `{avatarId}` (write, `admin`, UI only, compare-and-set: the loser gets `INVALID_STATE`).
- `choose_avatar` `{avatarId | null}` (write, `session`, UI only) puts a live gallery set on the member (`AVATAR_ARCHIVED`, `NOT_FOUND` otherwise) or takes it off. `redeem_invite` and `join_as_founder` take an optional `avatarImageId` with the same check. Two members may wear the same set (not refused unless the owner says so).
- Settings, "Your character", is the gallery grid once it has a set (the drawn character is the first tile), with the parametric editor under it as "Your drawn character" (what anyone who has not picked wears); until the gallery has one, only the editor. /join offers the grid too. `/admin/avatars` adds a set (before, after with each figure's pose, and the idle pose at the header, kitchen bar, dashboard and reminder sizes; 48/56/64 px), archives and restores.
- Everywhere a member is drawn (the hub header, the kiosk's avatar bar, the dashboard's acting chip, message and day-sheet rows, the reminder faces, the scoreboards, the admin members page) goes through one component, `MemberCharacter` (packages/ui): the idle pose at the whole-number multiple or fraction of its pixels closest to the drawn character's slot, the same factor for every pose, `image-rendering: pixelated`, or the drawn `Housemate` for a member who has not picked. A member's colour stays their character's shirt. Moments, subtle and only for a set that has the pose: emote for 2 seconds when the acting member scores (the "+N", `lib/ui/scored.ts`: the hub header and the kitchen's picked member) and when a face taps "I've seen it" on a reminder; the scoreboard's leader holds the emote pose; walk steps in on the kitchen dashboard's acting chip when someone taps in (under reduced motion, just idle).
- `/api/blob` serves `avatars/{id}/{name}.png` under the photo rules (the pathname must be one of that set's poses in the household), except that a signed-in account without a member row (someone on /join) may see them.

''' + s[b:]
open(p, "w").write(s)

p = "docs/SETUP.md"
s = open(p).read()
a = s.index("1. Make each character with Nano Banana")
b = s.index("If a cleaned character looks wrong")
s = s[:a] + '''Each character is a SET of three poses (owner ruling 2026-09-29): **idle** (standing,
three-quarter; used everywhere), **walk** (a short walk-in on the kitchen screen when someone taps
in) and **emote** (for example laughing with a peace sign: when they score, when they tap "I've
seen it", and for the scoreboard's leader). A set with only idle works; walk and emote can come
later as a new set.

1. Make each set with Nano Banana (Gemini image), all three poses side by side on ONE image,
   with this shared prompt so they match (add the person's description, or attach their photo,
   after it):

   ```text
   16-bit JRPG chibi pixel-art character sheet of one character, three full-body poses side
   by side, left to right: 1) idle, standing, three-quarter view; 2) walking, mid-stride;
   3) emote, laughing with a peace sign. Same character, same size and scale in every pose,
   feet on one line, space between the poses. Big head and small body, clean dark outline,
   flat shading with at most 24 colours, no dithering, no text, no shadow on the ground.
   Plain solid black background. Crisp square pixels. The character:
   ```

2. Download the image (PNG, JPEG or WebP; 4 MB at most; never SVG).
3. In the app: **Admin → Avatars → Add a character**, choose the sheet (or one file per pose).
   It shows before and after: the background (solid black or any flat colour, or a fake grey
   checkerboard) is removed from the edges in, the figures found left to right and cleaned at
   one scale with one palette of 24 colours, and the idle pose shown at the app's sizes. Pick
   48, 56 or 64 pixels tall (64 by default), check each figure's pose (change it, or skip one),
   name it and **Save to gallery**.
4. Everyone picks theirs in **Settings → Your character** (or when joining at `/join`). Two
   housemates may pick the same one; tell an agent if you want that refused. Until the gallery
   has a character, Settings keeps the drawn (hair/skin/shirt) character, and anyone who has not
   picked still wears theirs.
5. **Archive** takes a character out of the gallery; whoever already wears it keeps it.
   **Restore** puts it back. Nothing is ever deleted.

''' + s[b:]
s = s.replace("- [ ] **Make the characters, then add them at Admin → Avatars** (needs the Blob store above).", "- [ ] **Make the character sets (idle, walk, emote), then add them at Admin → Avatars** (needs\n      the Blob store above). Brooklyn's sheet and Ryan's idle are the first two.")
open(p, "w").write(s)

p = "apps/web/app/privacy/page.tsx"
s = open(p).read()
old = '''            <strong>Avatar images:</strong> the pixel characters an admin adds
            to the household&apos;s gallery (cleaned, about 56 pixels tall),
            who added each, and which one each member picked. The file as
            uploaded is not kept.'''
assert old in s
s = s.replace(old, '''            <strong>Avatar images:</strong> the pixel characters an admin adds
            to the household&apos;s gallery (up to three poses each, cleaned,
            48 to 64 pixels tall), who added each, and which one each member
            picked. The files as uploaded are not kept.''')
open(p, "w").write(s)
