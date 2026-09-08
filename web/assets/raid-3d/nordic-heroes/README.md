# Nordic courtyard adventurers

Three independently designed, textured medieval character meshes with their original skeletal animations: armored sword-and-shield knight, hooded bow ranger, and robed mage. These are low-polygon adult-proportion assets, intended for an isometric view.

Each self-contained `.glb` contains one skinned mesh, a 512×512 embedded diffuse texture and clips named exactly `Idle`, `Attack`, and `Hit`. Y is up and +Z is forward. The `Idle` pose at time 0 has its bottom at Y=0 and total height of 2 units. Normalize from this pose, because weapons and body movement change the animated bounds.

Freeze rest by playing `Idle`, setting mixer time to 0 and pausing the action. Play `Attack` once with effective time scale `clip.duration / 0.7`, then stop it, reset `Idle`, sample time 0, and pause it again. No procedural bone posing is required. The native clip lengths are retained; the runtime controls the short attack window.

`model-info.json` records final sizes, mesh/bone counts, animation durations, and sampled pose bounds. `preview.png` shows each model at the exact Idle first frame and midway through its native Attack. The mage's casting motion is intentionally subtle.

See [CREDITS.md](CREDITS.md) for mandatory author attribution, license links, original source downloads, and modifications. Include a visible link to these credits wherever the models are presented.
