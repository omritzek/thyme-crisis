Game art and audio go in one of the subfolders here — nothing loose goes
directly in this folder anymore:

- `backgrounds/` — level backdrops. See `backgrounds/README.md`.
- `enemies/` — enemy character sprites. See `enemies/README.md`.
- `music/menu/` — pairing-screen theme. See `music/menu/README.md`.
- `music/levels/` — per-level gameplay music. See `music/levels/README.md`.
- `music/boss/` — boss-level music override. See `music/boss/README.md`.
- `lobby/` — pairing/pre-round lobby artwork. See `lobby/README.md`.
- `cutscenes/intro/` — opening villain-monologue artwork. See `cutscenes/intro/README.md`.
- `cutscenes/outro/` — the two boss-ending scenes (defeated, then celebration). See `cutscenes/outro/README.md`.
- `boss/` — the final boss's in-fight sprite. See `boss/README.md`.

All of them work the same way: drop files in, no code changes needed, the
server picks them up automatically.
