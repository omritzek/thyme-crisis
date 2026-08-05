Drop background music tracks in this folder and they'll be picked up
automatically — no code changes needed. The game asks the server what's in
here on load (`GET /api/level-music`), and every time a regular (non-boss)
level begins, one track is picked at random from whatever's here and loops
for as long as that level lasts.

```
public/display/assets/music/levels/
  theme1.mp3
  theme2.mp3
  theme3.mp3
```

Filenames don't matter — there's no sorted order to line up with level
number the way backgrounds do, since the pick is random each time rather
than a fixed per-level mapping. With only one track here, it just always
plays that one; with several, replaying the same level number can come up
with a different track than last time.

## File requirements

- **Format:** `.mp3`, `.wav`, `.ogg`, or `.m4a` (detected by the file's actual bytes,
  not its extension).
- **Length:** doesn't matter — it loops seamlessly-ish (a hard loop back to
  the start, no crossfade within the track itself) for as long as that level
  lasts.

With no files here, gameplay is silent — this is expected and won't cause
errors.

See `../menu/README.md` for the pairing-screen theme, and `../boss/README.md`
for the dedicated final-boss-level override — both are always just a single
track, not a rotation.
