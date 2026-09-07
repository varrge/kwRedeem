# Dragon — Fully Animated

- Artist: **Cethiel**
- Source: https://opengameart.org/content/dragon-fully-animated
- Original archive: https://opengameart.org/sites/default/files/Dragon%20-%20Fully%20Animated.zip
- License: **CC0 1.0 Universal** — https://creativecommons.org/publicdomain/zero/1.0/
- Source and license inspected on 2026-09-05. The source description lists Attack 1, Attack 2, Idle, Idle Battle, Hurt, Death and Walking animations, rendered at 60 fps.

KaWang uses this artwork as the Leviathan character; it is not original KaWang artwork. No AI image generation was used. Each of the other seven characters has its own licensed artwork and provenance in its asset directory.

## Derived files

The original RGBA PNG frames are cropped to the same rectangle `(111, 35, 709, 389)` across **all** selected actions, resized to **512 × 303**, and packed into six-column WebP atlases (quality 82). Frame names below refer to files in `Dragon - Fully Animated/` inside the source archive. Alpha is preserved; no background has been painted in. No per-frame trimming or recoloring is performed.

| Output | Source folder / sampled frames | Frames | Atlas size |
| --- | --- | ---: | --- |
| `idle.webp` | `Idle/001.png` through `161.png`, step 4 | 41 | 3072 × 2121 |
| `idle-battle.webp` | `Idle Battle/001.png` through `137.png`, step 4, plus `140.png` | 36 | 3072 × 1818 |
| `hurt.webp` | `Hurt/01.png` through `61.png`, step 4, plus `62.png` | 17 | 3072 × 909 |
| `death.webp` | `Death/001.png` through `301.png`, step 4 | 76 | 3072 × 3939 |
| `poster.webp` | `Idle/001.png`, same crop/resize, quality 90 | 1 | 512 × 303 |

Idle / battle / hurt retain approximately the original duration. Death is played in 2.4 seconds to fit the transition to the next Boss. The webpage adjusts brightness and saturation for its dark stage; the distributed textures retain the original colors.
