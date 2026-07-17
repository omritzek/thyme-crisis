Drop an audio file in this folder and it'll be picked up automatically — no
code changes needed. The display asks the server what's in here on load
(`GET /api/soundtrack`), and if it finds anything, it loops it as background
music.

## File requirements

- **Format:** MP3, OGG, or WAV — detected by the file's actual bytes, not its
  extension, so it doesn't matter if it's missing one or has the wrong one.
- **Filenames:** anything at all, e.g. `theme.mp3`, `soundtrack.mp3`,
  `music`.
- Only one track is used. If you drop more than one file here, whichever
  sorts first alphabetically wins — keep just one to avoid ambiguity.

## Autoplay

Browsers block audio from playing automatically before the page has been
interacted with. The display tries to start the music as soon as it loads,
and if that's blocked, it automatically retries on the very first click, tap,
or key press anywhere on the page — no button or extra setup needed, it just
starts a beat after whoever's running the display first touches the screen
or keyboard.

With no file here, the game plays with no music at all — this is expected
and won't cause errors.
