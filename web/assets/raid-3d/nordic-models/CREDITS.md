# Northern raid bosses

All eight runtime models live in this directory. Each model embeds its textures;
there are no external model services or assets extracted from commercial games.

| Slot | Source / author | License | Provenance and changes |
| --- | --- | --- | --- |
| leviathan | Cethiel's dragon / Drummyfish, Cethiel | CC0 1.0 | Below |
| sentinel | Animated Defender / Danimal, Anthony Myers, Konstantin Maystrenko | CC BY 3.0 | [Details](sentinel.credits.md) |
| prism | Spider-Boss / esbxp | CC BY 4.0 | [Details](prism.credits.md) |
| zero-core | Animated Diablous / Clement Wu, Nikolaus, Botanic | CC BY 3.0 | [Details](zero-core.credits.md) |
| warden | Animated Bezerker / Clement Wu, Nikolaus, Botanic | CC BY 3.0 | [Details](warden.credits.md) |
| overmind | Darsh / Eldritch Grim | CC0 1.0 | [Details](overmind.credits.md) |
| behemoth | Animated Cerberus / Clement Wu, Nikolaus, Botanic | CC BY 3.0 | [Details](behemoth.credits.md) |
| singularity | Demonic Eye / Grefuntor, Atmostatic | CC BY 3.0 | [Details](singularity.credits.md) |

Leviathan, sentinel, zero-core, warden and behemoth retain source Death clips.
Prism and singularity have no authored clips; overmind retains only Idle. The
application supplies subtle whole-body breathing/hovering for the two static
sources, root recoil where HitReact is absent, and a 1.8-second seal disappearance
where Death is absent. These effects are not source-authored skeletal animations.

## Leviathan — northern raid dragon

`leviathan.glb` is **Cethiel's dragon (3D)** by **Drummyfish**, based on the
original dragon artwork by **Cethiel**. Both creators released their work under
**CC0 1.0 Universal**. Commercial use, modification, and redistribution are allowed;
attribution is optional and provided here for provenance.

- 3D model and license declaration: <https://opengameart.org/content/cethiels-dragon-3d>
- Original artwork: <https://opengameart.org/content/dragon-fully-animated>
- Author's source archive: <https://opengameart.org/sites/default/files/dragon_oga.zip>
- License: <https://creativecommons.org/publicdomain/zero/1.0/>
- Downloaded: 2026-09-08
- Source ZIP SHA-256: `f6a8c25dd3b2abdb1e7830b0b88f9083052c0750e710e6439eceb320783a57c1`

This is independent open art, not an asset from Skyrim or another Bethesda game.

## Conversion

Converted the archive's `dragon.dae` using Three.js r169 `ColladaLoader` and
`GLTFExporter`. The source geometry, skeleton, UVs, and authored animation keys
are preserved. The model uses the author's supplied `dragon_black.png` texture,
embedded in the GLB; it makes no external texture or buffer requests. The material
was converted from Collada Phong shading to a double-sided, non-metallic glTF PBR
material with roughness 0.88. The source Z-up orientation is retained beneath a
Y-up root transform.

The four separate Collada actions were bound to the same named source bones and
included in the GLB. Each action begins at time zero by subtracting its first
keyframe time; no synthetic bone animation was added.

| GLB clip | Original action file | Duration |
| --- | --- | ---: |
| `Idle` | `dragon_idle.dae` | 4.2083 s |
| `Death` | `dragon_die.dae` | 2.4583 s |
| `Attack` | `dragon_attack.dae` | 1.6667 s |
| `Walk` | `dragon_walk.dae` | 1.6250 s |

The source has no authored hit-reaction clip. The application may apply a brief
whole-model recoil for impacts; it should play the actual `Death` clip once and
clamp its final collapsed pose.

## Integration measurements

The model is a horned, plated quadruped with a spiked tail and small folded wings.
It faces approximately +Z with Y up. Measurements below use Three.js r169 after
playing `Idle` for 0.3 seconds and recomputing the skinned bounding box.

- GLB size: 716,784 bytes
- Skeleton: 32 bones; mesh: 3,786 exported skinned vertices
- Bounding-box size X/Y/Z: 0.421250 / 0.731630 / 1.122853
- Bounding-box center X/Y/Z: -0.009375 / 0.057348 / -0.133336
- Minimum Y: -0.308467

Normalize scale and ground placement from the posed bounds; original units and
foot position differ from the previous Quaternius dragon. Death rolls the body
onto its side and requires more horizontal room than idle. Idle, attack, walk,
and death were loaded from the resulting GLB and rendered in Chromium with
Three.js; front, back, and collapsed poses were visually checked.
