# Zero Core — infernal winged demon

`zero-core.glb` adapts **Animated Diablous** by **Clement Wu, Nikolaus & Botanic**, submitted by Botanic on OpenGameArt.

- Source page: <https://opengameart.org/content/animated-diablous>
- Original Blender rig: <https://opengameart.org/sites/default/files/diablous_v002_4.blend>
- Original diffuse texture: <https://opengameart.org/sites/default/files/diablous_texture_0.png>
- License selected from the authors' offered alternatives: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**, <https://creativecommons.org/licenses/by/3.0/>; legal text: <https://creativecommons.org/licenses/by/3.0/legalcode>.
- Source and license checked: 2026-09-08. Retain this attribution when redistributing. No endorsement by the authors is implied.
- Blender source SHA-256: `377ca1e09c26e3acee92ddcf146703612c43acbf5bcb75452ffaf38d6e814e14`
- Texture source SHA-256: `287247f47062f21eaf1bba76bb58f32bb731cee1fec71ca7a059aa53955064c4`

Modifications for kwRedeem: converted the original mesh, UVs, rig and authored animations to a self-contained glTF 2.0 binary with Blender 4.2.9; baked bone constraints; embedded the supplied 512 × 512 texture after reducing saturation and brightness; replaced the legacy diffuse material with a double-sided, non-metallic PBR material at roughness 0.88; retained and normalized the four strongest weights for vertices exceeding glTF's default four skin influences; normalized the idle height to 2 units with Y up, +Z facing and the ground at Y = 0. Geometry and the original character design are retained. No Bethesda/Skyrim assets are included.

All clips are source animations; `Die` was renamed `Death` and `Hit` was renamed `HitReact`. Death is the original collapse, with no synthesized bone motion.

| Exported clip | Duration |
| --- | ---: |
| Idle | 0.8750 s |
| Attack | 2.1250 s |
| HitReact | 0.9583 s |
| Death | 1.9167 s |
| Idle_2 | 1.7083 s |
| Run | 0.7083 s |
| Walk | 1.0417 s |

Validation: loaded and rendered with Three.js in Chromium; sampled every clip at 0%, 25%, 50%, 75% and 99%; checked finite posed bounds and all float accessors, embedded images/buffers, and visual idle/attack/death poses. Browser reported no errors. Export size: **515,868 bytes**; one skinned mesh, **53 bones**, **370 exported vertices**. Idle at time zero has size X/Y/Z **1.592567 / 2.000000 / 0.826786**, minimum **(-0.796284, 0.0000005, -0.413393)** and maximum **(0.796283, 2.000000, 0.413393)**.

The authored attack spreads the wings and rises to approximately **3.197 units high**; sampled HitReact width reaches approximately **3.293 units**. Fit the animated silhouette when choosing runtime scale. The source collapse can extend about 0.162 units below the idle ground; preserve the authored motion rather than applying per-frame grounding.
