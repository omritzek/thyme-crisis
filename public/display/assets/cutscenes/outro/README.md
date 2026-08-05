Drop the boss-ending cutscene sequence's artwork in this folder and it'll be
picked up automatically — no code changes needed. The game asks the server
what's in here on load (`GET /api/outro-images`) and plays every image
found, back to back, once the final boss (level 5) is defeated — the last
thing shown before everyone's disconnected back to the pairing screen, the
same as "Quit to Lobby" from the pause menu.

## Play order

Same sorted-order convention as level backgrounds/music — whichever
filename sorts first plays first:

```
public/display/assets/cutscenes/outro/
  1 - sad cyborg.png        <- plays first (him defeated)
  2 - celebration.png       <- plays second (the group celebrates)
  3 - to be continued.png   <- plays third (sequel hook, or whatever else)
```

Plain names work too as long as they sort in the order you want (careful
with 10+ images — zero-pad if you ever get that far). Any number of images
works, not just two or three — drop in more to extend the sequence, remove
some to shorten it.

## The text lines

Each image gets paired by position with an entry in `BOSS_OUTRO_TEXTS` (an
array in `display.js`) — the first image plays with `BOSS_OUTRO_TEXTS[0]`,
the second with `BOSS_OUTRO_TEXTS[1]`, and so on. If there are more images
than text lines, the extras just play with no text (art only); if there are
more lines than images, the extra lines still play as text-only scenes on a
plain dark background rather than being skipped. The lines themselves are
narrative, not swappable art, so they're not a dropped-in asset here — edit
the array directly.

## File requirements

- **Format:** `.png`, `.jpg`, `.jpeg`, or `.webp` (detected by the file's
  actual bytes, not its extension).

With an empty folder, the whole sequence still plays — every line in
`BOSS_OUTRO_TEXTS`, each as a text-only scene — this is expected and won't
cause errors.
