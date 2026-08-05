Drop the opening villain-monologue cutscene's artwork in this folder and
it'll be picked up automatically — no code changes needed. The game asks the
server what's in here on load (`GET /api/intro-image`) and shows it,
letterboxed, behind the streaming dialogue text the first time a game
actually starts (once everyone's readied up in the lobby).

## File requirements

- **Format:** `.png`, `.jpg`, `.jpeg`, or `.webp` (detected by the file's
  actual bytes, not its extension).

## Just one image, not a rotation

Same as `../../lobby/` — if more than one file ends up here, only the first
one (alphabetically) is used.

The dialogue text itself isn't a dropped-in asset; it's set in `INTRO_TEXT`
in `display.js`, since it's game narrative rather than swappable art.

With no image here, the cutscene still plays (text only, on a plain dark
background) — this is expected and won't cause errors.
