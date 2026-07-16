Put a background image directly in this folder — any filename, any of `.png`,
`.jpg`, `.jpeg`, `.webp` (e.g. `playground.jpg`, `ganash.png`, whatever). The
server looks for the first image file it finds here and the display uses it
automatically; you don't need to name it anything specific.

It's drawn cover-fit to the game's 1280×720 canvas, so any reasonably
landscape-oriented image works; very tall or very narrow images will get
cropped more aggressively on one axis.

If no image is here, the display falls back to a plain dark background with
no errors — this is expected until one is added.

If you add more than one image file directly in this folder (not counting
the `enemies/` subfolder), whichever sorts first alphabetically wins — keep
just one here to avoid ambiguity.

See `enemies/README.md` for adding enemy character sprites, which work the
same way (drop files in, no code changes).
