Drop enemy sprite images in this folder and they'll be picked up automatically —
no code changes needed. The game asks the server what's in here on load
(`GET /api/enemy-sprites`), and if it finds anything, it uses those images
instead of the built-in drawn face. If you add more than one, a random one is
picked each time a new enemy spawns.

## File requirements

- **Format:** PNG with a transparent background. JPG doesn't support
  transparency, so a JPG here will show as a solid square instead of a
  character silhouette.
- **Shape:** any aspect ratio — square, portrait, whatever. The game fits the
  image to size along its longer edge and keeps its native proportions
  (no stretching), so a tall portrait crop looks the same as a square one,
  just narrower.
- **Size:** enemies render at different sizes depending on how "far" or
  "close" their spawn point is, so the on-screen footprint (longer edge)
  ranges roughly 85–170 logical pixels. Enough resolution to look sharp at
  the top of that range (say 400px on the longer edge) is plenty — more just
  means a bigger file for no visible benefit.
- **Orientation:** draw the character facing right. The game mirrors it
  automatically when it spawns on the right half of the screen (so it always
  faces toward the center).
- **Filenames:** anything, as long as the extension is `.png`, `.jpg`,
  `.jpeg`, or `.webp` — e.g. `enemy1.png`, `soldier.png`, `guy-with-hat.png`.

## Optional: one or more "hit" poses

Name a file `<name>-hit.<ext>` and it's automatically paired with `<name>.<ext>`
as its hit-reaction sprite — shown for a brief moment when that enemy gets shot,
instead of the default white-flash tint effect. It isn't spawnable on its own.

Want more variety? Add several numbered ones — `<name>-hit1.<ext>`,
`<name>-hit2.<ext>`, etc. — and one is picked at random each time that enemy
is shot.

```
public/display/assets/enemies/
  soldier.png        <- normal pose (spawnable)
  soldier-hit.png     <- soldier's only hit pose, shown every time it's shot
  guard.png           <- normal pose, no hit variant -> falls back to white-flash tint
  robot.png           <- normal pose (spawnable)
  robot-hit1.png      <- one of three hit poses, picked at random when shot
  robot-hit2.png
  robot-hit3.png
```

A `-hit`/`-hit<N>` file with no matching base file (e.g. `mystery-hit.png`
with no `mystery.png`) is just ignored.

## Toughness by name

A base sprite named exactly `arsketer` is treated as the "buffed" enemy
type (needs multiple hits to put down, more likely to show up at higher
levels/difficulties); a base sprite named `arsnormal` (or anything else not
reserved) is a normal one-hit enemy. See `hitsToKillForEnemyName` and
`arsketerChanceForLevel` in `display.js` for the exact rules — no code
change needed, this is purely by filename.

## Reserved name: `cat`

A base sprite named exactly `cat` is **not** a spawnable enemy at all, even
though it lives in this same folder — it's used instead as the decoy's own
image (replacing the built-in drawn cat shape) wherever a decoy would
otherwise appear. It's excluded from the random enemy pool entirely, so
naming a real enemy sprite `cat` will just make it vanish from spawning
rather than showing up as a decoy — pick a different name for an actual
enemy.

## Example

```
public/display/assets/enemies/
  enemy1.png
  enemy2.png
  enemy3.png
```

With no files here, the game falls back to its built-in drawn low-poly face —
this is expected and won't cause errors.
