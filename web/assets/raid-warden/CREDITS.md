# Dark Saber (Werewolf)

**werewolf sprite by MindChamber**

- Artist: [MindChamber](https://opengameart.org/users/mindchamber)
- Source: https://opengameart.org/content/dark-saber-werewolf
- Original archive: https://opengameart.org/sites/default/files/DarkSaber_0.zip
- License: [Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/)
- Source, license, and the artist's requested attribution above verified on 2026-09-05.

KaWang uses this existing, author-animated character for Warden (血月典狱长). This is not original KaWang artwork. The source describes the character as the third boss from Redbaron. No AI image generation, recoloring, invented poses, or additional drawn effects were used. Preserve the artist attribution and license link when redistributing these derived assets.

## Derived files

The original RGBA PNG sequences have different action canvases. Every frame within an action receives the same translation into a shared coordinate system: idle `(0, 0)`, hurt `(-306, -67)`, death `(0, -59)`. These offsets align the standing feet while preserving the original movement within each action. The common padded crop is `(-314, -75, 671, 465)`, uniformly reduced from `985 × 540` to `512 × 281` and packed into six-column, lossless WebP atlases. Transparent pixels are preserved. No frame is individually trimmed, recentered, stretched, or enlarged.

| Output | Original PNG frames in `DarkSaber/` | Frames | Duration |
| --- | --- | ---: | ---: |
| `idle.webp` | `idle/darksaber_stand0001.png` through `darksaber_stand0050.png` | 50 | 1667 ms |
| `idle-battle.webp` | `idle/darksaber_stand0051.png` through `darksaber_stand0100.png` | 50 | 1667 ms |
| `hurt.webp` | All 26 PNG frames from `Hit/`, in filename order | 26 | 1000 ms |
| `death.webp` | `death/darksaber_death0001.png` through `darksaber_death0101.png` | 101 | 3200 ms |
| `poster.webp` | `idle/darksaber_stand0001.png`, same canvas and scale | 1 | — |

The archive notes that the second half of idle repeats the animation with a shake; this authored variation supplies the battle idle. Playback durations are adapted for the raid interface. The complete death animation includes the werewolf reverting to human form and falling prone. Its final nonempty source frame, `darksaber_death0101.png`, is retained as the frozen ending. No disappearing or replacement frame is added.

All 227 selected source frames were checked against ZIP CRCs. All 227 exported frames were checked for nonempty alpha and a transparent margin on every side, and each decoded WebP alpha channel was compared with its uncompressed atlas. Contact sheets were visually inspected for action continuity and clipping.
