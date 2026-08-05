Drop the final boss's in-fight sprite in this folder and it'll be picked up
automatically — no code changes needed. The game asks the server what's in
here on load (`GET /api/boss-sprite`) and uses it to render the boss during
the level 5 fight (see `spawnBoss`/`updateBossFight` in `display.js`).

This is separate from `../enemies/` because the boss is one specific,
always-the-same character, not a randomly-picked-per-spawn reskinnable
enemy.

## File requirements

- **Format:** PNG with a transparent background. JPG doesn't support
  transparency, so a JPG here will show as a solid rectangle instead of a
  character silhouette.
- **Shape:** any aspect ratio — the game fits the image to size along its
  longer edge and keeps its native proportions, same as a regular enemy
  sprite.
- **Filenames:** anything, as long as the extension is `.png`, `.jpg`,
  `.jpeg`, or `.webp` (detected by the file's actual bytes either way).

## Just one image, not a rotation

If more than one file ends up here, only the first one (alphabetically) is
used.

With no image here, the boss falls back to the intro cutscene's own artwork
(if present), then to the built-in drawn face — this is expected and won't
cause errors.
