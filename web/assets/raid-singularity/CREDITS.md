# 星渊术士 — Wizard character (animated)

- Artist: **ruberboy**
- Source: https://opengameart.org/content/wizard-characteranimated
- Original archive: https://opengameart.org/sites/default/files/magician_v1.0.zip
- License: **CC0 1.0** — https://creativecommons.org/publicdomain/zero/1.0/
- Source and license checked 2026-09-05.

The source contains hand-painted artwork, DragonBones project files, and pre-rendered PNG sequences. KaWang uses the PNG idle25 / damage13 / die37 frames; battle mode uses the original idle sequence at a shorter1.35s duration (there is no distinct source battle-idle clip). The other durations are idle2s, hurt850ms, death2.2s.

Different source action canvases receive a single fixed translation per action to align the initial standing foot position; the exact translations and common crop are in `metadata.json`. Every frame then uses the same493×512 canvas, six columns per atlas. There is no per-frame recentering and the final fallen pose stays visible. Converted to WebP quality86 with transparent alpha retained. Original art/animation: ruberboy; conversion and page color grading: KaWang.
