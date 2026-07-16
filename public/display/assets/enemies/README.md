Drop enemy sprite images in this folder and they'll be picked up automatically —
no code changes needed. The game asks the server what's in here on load
(`GET /api/enemy-sprites`), and if it finds anything, it uses those images
instead of the built-in drawn face. If you add more than one, a random one is
picked each time a new enemy spawns.

## File requirements

- **Format:** PNG with a transparent background. JPG doesn't support
  transparency, so a JPG here will show as a solid square instead of a
  character silhouette.
- **Shape:** roughly square, with the character centered and reasonable
  margin around it (don't crop tight to the edges — the game scales the whole
  image, margin and all).
- **Size:** 256×256 to 512×512px is plenty. It's drawn at a small on-screen
  size (roughly 90×90 logical pixels), so more resolution than that just
  means a bigger file for no visible benefit.
- **Orientation:** draw the character facing right. The game mirrors it
  automatically when it spawns on the right half of the screen (so it always
  faces toward the center).
- **Filenames:** anything, as long as the extension is `.png`, `.jpg`,
  `.jpeg`, or `.webp` — e.g. `enemy1.png`, `soldier.png`, `guy-with-hat.png`.

## Optional: a dedicated "hit" pose

Name a file `<name>-hit.<ext>` and it's automatically paired with `<name>.<ext>`
as its hit-reaction sprite — shown for a brief moment when that enemy gets shot,
instead of the default white-flash tint effect. It isn't spawnable on its own.

```
public/display/assets/enemies/
  soldier.png       <- normal pose (spawnable)
  soldier-hit.png    <- shown briefly when soldier.png gets shot
  guard.png          <- normal pose, no hit variant -> falls back to white-flash tint
```

A `-hit` file with no matching base file (e.g. `mystery-hit.png` with no
`mystery.png`) is just ignored.

## Example

```
public/display/assets/enemies/
  enemy1.png
  enemy2.png
  enemy3.png
```

With no files here, the game falls back to its built-in drawn low-poly face —
this is expected and won't cause errors.
