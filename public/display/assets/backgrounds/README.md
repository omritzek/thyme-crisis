Drop background images in this folder and they'll be picked up automatically —
no code changes needed. The game asks the server what's in here on load
(`GET /api/background-image`), and each image becomes one level's backdrop.

## Level order

Files are sorted alphabetically, and that order becomes level order: whichever
sorts first is Level 1's backdrop, the next is Level 2's, and so on. Clearing
a level's enemy wave advances to the next image, wrapping back to the first
once you run out.

Name them so they sort the way you want levels to play, e.g.:

```
public/display/assets/backgrounds/
  1-playground.jpg   <- Level 1
  2-rooftop.jpg       <- Level 2
  3-subway.jpg        <- Level 3
```

Plain names work too as long as they sort in the order you want (careful with
10+ levels — "10" sorts before "2" alphabetically, so zero-pad if you get that
far: `01-`, `02-`, ... `10-`).

With only one image here, every level still advances (same backdrop, but a
fresh transition + higher level number each time) — dropping in more images
later is enough to give later levels their own backdrop.

## File requirements

- **Format:** `.png`, `.jpg`, `.jpeg`, or `.webp` (detected by the file's
  actual bytes, not its extension).
- **Orientation:** it's drawn cover-fit to the game's 1280×720 canvas, so any
  reasonably landscape-oriented image works; very tall or very narrow images
  will get cropped more aggressively on one axis.

If no image is here, the display falls back to a plain dark background with
no errors — this is expected until one is added.

See `../enemies/README.md` for adding enemy character sprites, which work the
same way (drop files in, no code changes).
