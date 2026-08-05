Drop a music track in this folder (e.g. `boss-fight.mp3`) and it'll be
picked up automatically — no code changes needed. The game asks the server
what's in here on load (`GET /api/boss-music`) and, if found, plays it in
place of the normal per-level rotation for the entire final boss level: from
the moment his taunt cutscene begins, through the fight itself, through both
ending cutscenes (him defeated, then the group's celebration) — right up
until everyone's disconnected back to the pairing screen.

## File requirements

- **Format:** `.mp3`, `.wav`, or `.ogg` (detected by the file's actual
  bytes, not its extension).
- **Filenames:** anything, as long as the extension (or actual audio
  format) is one of the above — `boss-fight.mp3` works, so does anything
  else.

## Just one track, not a rotation

Same as `../menu/` — if more than one file ends up here, only the first one
(alphabetically) is used.

With no file here, the boss level just uses whatever's in `../levels/` like
any other level — this is expected and won't cause errors.
