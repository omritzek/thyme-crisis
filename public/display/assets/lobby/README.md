Drop the pairing-screen / pre-round lobby artwork in this folder and it'll be
picked up automatically — no code changes needed. The game asks the server
what's in here on load (`GET /api/lobby-image`) and uses it as the backdrop
for both:

- the pairing screen (session code + QR code), and
- the "logged in / ready up" screen shown once at least one phone has
  joined but the round hasn't started yet (players' crosshairs, login
  status, and the shootable START target are drawn on top of it).

## File requirements

- **Format:** `.png`, `.jpg`, `.jpeg`, or `.webp` (detected by the file's
  actual bytes, not its extension).
- **Fit:** letterboxed to fit entirely on screen (not cropped), since a
  poster-style image usually has text/logo near the edges that shouldn't get
  cut off. A dark background shows in any letterboxed margin, so art with a
  black/near-black background blends in seamlessly.

## Just one image, not a rotation

Unlike backgrounds/levels, this isn't a playlist — if more than one file
ends up here, only the first one (alphabetically) is used.

With no file here, both screens fall back to a plain dark background — this
is expected and won't cause errors.
