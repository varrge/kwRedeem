# Behemoth — northern three-headed hound

`behemoth.glb` adapts **Animated Cerberus** by **Clement Wu, Nikolaus & Botanic**, submitted by Botanic on OpenGameArt.

- Source page: <https://opengameart.org/content/animated-cerberus>
- Original Blender rig: <https://opengameart.org/sites/default/files/cerberus_v002.blend>
- Original diffuse texture: <https://opengameart.org/sites/default/files/cerberus_texture_0.png>
- License selected from the authors' offered alternatives: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**, <https://creativecommons.org/licenses/by/3.0/>; legal text: <https://creativecommons.org/licenses/by/3.0/legalcode>.
- Source and license checked: 2026-09-08. Retain this attribution when redistributing. No endorsement by the authors is implied.
- Blender source SHA-256: `abd30c21089f64e55e603192614e8b5c6c53839eebd851cf89b04edd840b649f`
- Texture source SHA-256: `f339fd799172718763658476a1ebc5bece3eaf83038b6ff27816a126176dc449`

Modifications for kwRedeem: converted the original mesh, UVs, rig and authored animations to a self-contained glTF 2.0 binary with Blender 4.2.9; baked bone constraints; embedded the supplied 512 × 512 texture after reducing saturation and applying a cold gray-blue color grade; replaced the legacy diffuse material with a double-sided, non-metallic PBR material at roughness 0.88; normalized the idle height to 2 units with Y up, +Z facing and the ground at Y = 0. Geometry and the original character design are retained. No Bethesda/Skyrim assets are included.

All clips are source animations; `die` was renamed `Death` and `hit` was renamed `HitReact`. Death is the original collapse, with no synthesized bone motion.

| Exported clip | Duration |
| --- | ---: |
| Idle | 0.8750 s |
| Attack | 1.7083 s |
| HitReact | 0.8750 s |
| Death | 1.4583 s |
| Walk | 1.2917 s |

Validation: loaded and rendered with Three.js in Chromium; sampled every clip at 0%, 25%, 50%, 75% and 99%; checked finite posed bounds and all float accessors, embedded images/buffers, and visual idle/attack/death poses. Browser reported no errors. Export size: **391,736 bytes**; one skinned mesh, **49 bones**, **482 exported vertices**. Idle at time zero has size X/Y/Z **1.763831 / 2.000000 / 3.452561**, minimum **(-0.844591, -0.0000005, -1.728757)** and maximum **(0.919240, 2.000000, 1.723805)**. The source collapse can extend about 0.108 units below the idle ground; preserve the authored motion rather than applying per-frame grounding.
