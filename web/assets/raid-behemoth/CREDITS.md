# Rock Monster — Behemoth

- Original character artwork: **Joseph Crown (jcrown41)**.
- Source: https://opengameart.org/content/rock-monster
- Original archive: https://opengameart.org/sites/default/files/Monster.zip
- Artist: https://opengameart.org/users/jcrown41 — www.crownjoseph.com
- License: **CC0 1.0 Universal** — https://creativecommons.org/publicdomain/zero/1.0/
- Source page and archive README inspected on 2026-09-05. The README permits commercial and non-commercial use without attribution; credit is retained here voluntarily.

The original asset contains **static, separated PNG body parts**, not animation clips. The drawing, original colors, rune details and luminous collar are Joseph Crown's work. **KaWang / Codex authored the animation poses, bone motion, stone-fragment collapse, small particles and atlas conversion** used here. These files must not be described as original animation supplied by the artist.

## Derivation

The eleven parts are `Monster/Normal/{body,head,left hand,left leg,left shoulder,left thigh,right hand,right leg,right shoulder,right thigh}.png` and `Monster/Glow/neck.png`. Their original positions were recovered by matching image pixels against `Monster/Normal/Monster-full.png`, preserving the original assembled anatomy and asymmetrical fist. All parts share a uniform scale of 0.19, with source point `(1500, 1320)` registered to frame point `(256, 259)`.

Standing actions independently move the floating head, collar, torso, shoulders, arms and lower body. Hurt adds a damped recoil with a larger rotation at the oversized fist and a separate head response. For death, the torso is partitioned along its visible stone seams; torso stones, limbs and head rotate and fall independently while the collar fades. Low-opacity residual edges on separated torso fragments are removed. The final rubble remains visible and stops moving; no whole-character fade is applied. Battle idle has a slightly stronger motion and a few new cyan particles. No generated replacement character artwork is used.

All clips use the same **512 × 512** transparent frame coordinates with **six columns** and no per-frame trimming or recentering. Atlases use WebP quality 87; the poster uses quality 93. Alpha is encoded losslessly. Each frame's alpha bounds and the alpha after encoding are checked to ensure the artwork retains padding and transparency.

| Output | Frames | Duration |
| --- | ---: | ---: |
| `idle.webp` | 24 | 2400 ms |
| `idle-battle.webp` | 24 | 1920 ms |
| `hurt.webp` | 12 | 660 ms |
| `death.webp` | 24 | 1680 ms |

`poster.webp` is the first idle frame. `metadata.json` records the source, registration, atlas dimensions and playback timing.
