# Animated raid monster models

All eight models and their embedded atlas textures are by **Quaternius**, from
the **Ultimate Monsters** pack, released under **CC0 1.0 Universal** (public
domain dedication). Commercial use, modification, and redistribution are allowed.

- Author and pack: <https://quaternius.com/packs/ultimatemonsters.html>
- Author's download folder: <https://drive.google.com/drive/folders/18m4KpzpEzhC9wl7jzr6dUc0N8Jozr79C>
- License: <https://creativecommons.org/publicdomain/zero/1.0/>
- Pack license file: <https://drive.google.com/file/d/16GqsDGESyEOfRbc4dS7EqAwkIUSIW4_y/view>

Downloaded directly from the author's Google Drive on 2026-09-07; no third-party
mirror was used. The original self-contained glTF JSON and embedded binary buffer
were repackaged as GLB 2.0. Geometry, atlas image, materials, rigs, and animation
tracks were preserved; no external texture request is required.

## File mapping

| Local file / boss key | Original model | Pack folder | Appearance | Original download |
| --- | --- | --- | --- | --- |
| `leviathan.glb` | Dragon_Evolved.gltf | Flying/glTF | Orange horned dragon with wings | [Author file](https://drive.google.com/file/d/1Mcfuavq7F4itG9xhqc-20_IL257ZY2_3/view) |
| `sentinel.glb` | Goleling_Evolved.gltf | Flying/glTF | Green crowned gargoyle with wings | [Author file](https://drive.google.com/file/d/1DXqke-QxMth9mq5eYiawcmJDACm4-jvL/view) |
| `prism.glb` | Armabee_Evolved.gltf | Flying/glTF | Black/yellow striped flying insect | [Author file](https://drive.google.com/file/d/196ay2r-nuDXcRiwYu84CoE7Qy_gBj8sB/view) |
| `zero-core.glb` | Alien.gltf | Big/glTF | Purple alien with green curled antennae | [Author file](https://drive.google.com/file/d/1rWF4Jo_G7-odDa5LfkQ0e2d9_p9pxb3W/view) |
| `warden.glb` | Orc_Skull.gltf | Big/glTF | Green skull-masked orc with spiked club | [Author file](https://drive.google.com/file/d/13wbbztVj_2eYyF5lavumLvK9JyCfQEhI/view) |
| `overmind.glb` | Squidle.gltf | Flying/glTF | Pink winged imp with horns and a long tongue | [Author file](https://drive.google.com/file/d/1VbcCYeqrlwYF6b64EY2S_e9hV0HXMr3O/view) |
| `behemoth.glb` | Yeti.gltf | Big/glTF | White/blue yeti | [Author file](https://drive.google.com/file/d/1_skNq11VXoaGPu9D-hHb4-0OQXEWNTzY/view) |
| `singularity.glb` | Ghost_Skull.gltf | Flying/glTF | Purple floating skull ghost | [Author file](https://drive.google.com/file/d/1JIw8lx6H5IIhf_3Z5FprEu_yCoMcoRN7/view) |

## Embedded animations

The five Flying models contain these exact, case-sensitive clip names:
`Death`, `Fast_Flying`, `Flying_Idle`, `Headbutt`, `HitReact`, `No`, `Punch`, `Yes`.

The three Big models (`zero-core`, `warden`, `behemoth`) contain:
`Death`, `Duck`, `HitReact`, `Idle`, `Jump`, `Jump_Idle`, `Jump_Land`, `No`, `Punch`,
`Run`, `Walk`, `Wave`, `Weapon`, `Yes`.

Use `Flying_Idle` / `Idle` for idle motion, `HitReact` for impacts, and `Death`
as a clamped one-shot. Flying models have a 0.667-second Death clip; Big models
have a 0.767-second Death clip. Ground-model `Weapon` can play the orc's club
attack. Models face approximately +Z before scene placement.

## Integration measurements

Dimensions are approximate X/Y/Z world-space extents in the original model units,
sampled 0.3 seconds into the idle clip using Three.js r169. Recompute a skinned
bounding box after posing for camera placement; dimensions vary during animation.

| Boss key | GLB bytes | Idle X × Y × Z | Bones | Skinned vertices |
| --- | ---: | --- | ---: | ---: |
| leviathan | 555944 | 4.173 × 2.870 × 2.246 | 46 | 4437 |
| sentinel | 318484 | 3.746 × 3.130 × 1.776 | 13 | 3688 |
| prism | 215892 | 3.515 × 2.258 × 1.552 | 13 | 2022 |
| zero-core | 673476 | 3.130 × 3.399 × 1.585 | 43 | 4227 |
| warden | 676468 | 3.127 × 3.122 × 1.696 | 43 | 4504 |
| overmind | 429248 | 3.746 × 2.621 × 2.246 | 43 | 2943 |
| behemoth | 622288 | 3.128 × 2.680 × 1.508 | 43 | 3415 |
| singularity | 357208 | 2.690 × 3.093 × 2.100 | 38 | 2408 |

Verified with Three.js GLTFLoader in Chromium: all models load with embedded
materials, all animation clips evaluate to finite bounds, and all eight models
render with no JavaScript or console errors.
