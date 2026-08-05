Drop the pairing-screen theme song in this folder and it'll be picked up
automatically — no code changes needed. The game asks the server what's in
here on load (`GET /api/menu-music`) and plays it, looping, while the
pairing/"waiting for players" screen is showing.

## File requirements

- **Format:** `.mp3`, `.wav`, `.ogg`, or `.m4a` (detected by the file's actual bytes,
  not its extension).
- **Filenames:** anything.

## Just one track, not a rotation

Unlike backgrounds/levels, this isn't a playlist — if more than one file ends
up here, only the first one (alphabetically) is used. If you want to swap the
theme, remove the old file rather than adding a second one.

With no file here, the pairing screen is silent — this is expected and won't
cause errors.

See `../levels/README.md` for per-level gameplay music, which works the same
way (drop a file in, no code changes).
