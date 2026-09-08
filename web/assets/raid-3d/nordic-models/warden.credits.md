# Warden — ash-haired greatsword executioner

`warden.glb` adapts **Animated Bezerker**, by **Clement Wu, Nikolaus & Botanic**, submitted by Botanic on OpenGameArt.

- Source page: https://opengameart.org/content/animated-bezerker
- Original model: https://opengameart.org/sites/default/files/berzerker_v002_0.blend
- Original texture: https://opengameart.org/sites/default/files/berzerker_texture.png
- License: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**, selected from the author's alternative licenses — https://creativecommons.org/licenses/by/3.0/ ; legal text: https://creativecommons.org/licenses/by/3.0/legalcode . Commercial use and redistribution are permitted with attribution. Retain this attribution when redistributing the adapted model. No endorsement by the authors is implied.

Modifications for kwRedeem: exported the original mesh, cape, greatsword and rig to a self-contained glTF 2.0 binary; converted the diffuse texture to a rough PBR material; reduced texture saturation and brightness, changed orange hair to ash/silver and red eyes to dark slate; baked original bone constraints; normalized the Idle starting bounds to 2 units high and bottom at zero in Y-up, +Z-front coordinates.

Retained original native `Idle` and `Attack`; renamed original `Hit` to `HitReact` and original `Die` to `Death`. The source Blender file contains `Die` even though the download page's animation list omits it. No replacement clips were invented; unused walking animation was excluded. The distinct bare arms, broad dark cape, heavy boots and greatsword are the original character design.

No Bethesda/Skyrim assets are included. Source and license checked 2026-09-08.
