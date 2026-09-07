# Crazy Mushroom (purple) — Forest Fiends

- Artist: **LudicArts** — https://www.ludicarts.com/
- Source: https://opengameart.org/content/forest-fiends-free-character-pack
- Original archive: https://opengameart.org/sites/default/files/forestfiendspackoga.zip
- License: **Creative Commons Attribution 4.0 International (CC BY 4.0)** — https://creativecommons.org/licenses/by/4.0/
- Source and licensing inspected on 2026-09-05. Attribution requested by the original author: https://www.ludicarts.com/.

KaWang uses this artwork as the Prism Boss. The character artwork and animation are by LudicArts. KaWang's changes are registration alignment, shared cropping/resizing, and WebP atlas packing; no recoloring or generated artwork is included.

## Derived files

All source PNGs retain transparency and original color. The source provides a different fixed canvas for each action. A single fixed translation per action aligns its initial standing pose to the initial idle pose; that translation is applied identically to every frame of that action. Relative movement inside each action is preserved. The union of all selected translated alpha bounds is padded by eight source pixels and cropped to `(-184, 20, 507, 615)`, then resized uniformly to **512 × 441**. There is no per-frame trimming or recentering. Registration translations and original canvas dimensions are in `metadata.json`.

Atlases use six columns, two rows, and WebP quality 86 with exact lossless alpha. `poster.webp` is the first idle frame at quality 90. All ten original frames are retained for each action. Playback is 12 fps (833 ms per clip). `Idle2` supplies the distinct battle idle. `Death2` supplies the death animation because its final frames show the fallen character settled on the ground; the source's final held corpse pose and opacity are retained without adding a fade.

Source directory: `ForestFiendsPackOGA/_Pack_crazy_mushroom/Large/`

| Output | Source frames | Frames | Duration |
| --- | --- | ---: | ---: |
| `idle.webp` | `purple_idle1__000.png` through `__009.png` | 10 | 833 ms |
| `idle-battle.webp` | `purple_idle2__000.png` through `__009.png` | 10 | 833 ms |
| `hurt.webp` | `purple_hurt__000.png` through `__009.png` | 10 | 833 ms |
| `death.webp` | `purple_death2__000.png` through `__009.png` | 10 | 833 ms |

The final two unused atlas cells remain transparent. The conversion checks every frame for alpha, unclipped padding, atlas dimensions and unchanged alpha after WebP encoding.
