# Arena hero assets

Created by **Kay Lousberg**, from **KayKit: Adventurers Character Pack 1.0**.
Licensed under **CC0 1.0 Universal**; see [LICENSE.txt](LICENSE.txt).

- Author/project: https://kaylousberg.itch.io/kaykit-adventurers
- Official repository: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
- Source revision: `672074b73ba276876a19e8816ecdc5241817ab47`
- Source directory: `addons/kaykit_character_pack_adventures/Characters/gltf/`
- Downloaded: 2026-09-08

| Local file | Original GLB | Included original equipment | Native Idle clip | Native Attack clip |
| --- | --- | --- | --- | --- |
| `knight.glb` | `Knight.glb` | Helmet, cape, one-handed sword, badge shield | `Idle` | `1H_Melee_Attack_Slice_Diagonal` |
| `ranger.glb` | `Rogue_Hooded.glb` | Hood, cape, two-handed crossbow | `2H_Ranged_Aiming` | `2H_Ranged_Shoot` |
| `mage.glb` | `Mage.glb` | Hat, cape, staff, open spellbook | `Idle` | `Spellcast_Shoot` |

Direct original downloads use:
`https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/672074b73ba276876a19e8816ecdc5241817ab47/addons/kaykit_character_pack_adventures/Characters/gltf/<Original GLB>`

These are self-contained GLB files with embedded textures. Conversion used the
project's Three.js 0.169.0 GLTFLoader/GLTFExporter: unused overlapping equipment
was removed, animation keyframes were optimized, and three original animations
were retained under the names `Idle`, `Attack`, and `Hit` (`Hit_A` upstream).
No geometry, textures, skeletons, attachment transforms, or motions were authored
for this project. Equipment retains the author's hand/head/chest attachments.

Each character has six skinned meshes sharing its 41-bone rig. Models use Y-up,
face +Z, and stand approximately at Y=0; keep their relative source dimensions
when assembling a party. Clip durations in seconds:

| Model | Idle | Attack | Hit |
| --- | ---: | ---: | ---: |
| Knight | 1.067 | 1.000 | 0.667 |
| Ranger | 1.600 | 1.067 | 0.667 |
| Mage | 1.067 | 0.933 | 0.667 |

Round-trip verification loaded all exported files, sampled every clip at five
points, checked finite bounds, and rendered the Idle/Attack poses in Chromium.
