# Sentinel — medieval halberd guardian

`sentinel.glb` adapts **Animated Defender AKA Brigand**, by **Konstantin Maystrenko (concept), AnthonyMyers / Anthony Myers (model), and Danimal (retopology, rigging and animation)**.

- Source page and attribution: https://opengameart.org/content/animated-defender-aka-brigand
- Original download: https://opengameart.org/sites/default/files/Defender.zip (`Defender.blend`, including packed diffuse and normal textures).
- License: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)** — https://creativecommons.org/licenses/by/3.0/ ; legal text: https://creativecommons.org/licenses/by/3.0/legalcode . Commercial use and redistribution are permitted with attribution. Retain this attribution when redistributing the adapted model. No endorsement by the authors is implied.

Modifications for kwRedeem: exported the original character and rig to self-contained glTF 2.0 binary; excluded source presentation planes and unused metarig; converted the packed diffuse and normal textures to rough PBR materials; reduced diffuse saturation and brightness; resized normal maps to 1024 square; baked original rig constraints; kept the four strongest skin influences per vertex for the browser renderer; normalized the Idle starting bounds to 2 units high, bottom at zero, and rotated to face +Z in Y-up coordinates.

Native animation excerpts follow the author's NLA selections: `Idle` uses frames 3–15 of `Attack-two handed2` (one cycle of the author's repeated Idle strip), `Attack` uses frames 108–136 of that action (`Attack1`), and `Death` uses frames 2–98 of `Death-Backwards`. Unused actions were excluded from export. There is no native HitReact animation; no replacement clip was invented.

No Bethesda/Skyrim assets are included. Source and license checked 2026-09-08.
