import { build } from "esbuild";
import fs from "node:fs";
const keys=["leviathan","sentinel","prism","zero-core","warden","overmind","behemoth","singularity"];
const options={entryPoints:["web/raid-arena-source.js"],bundle:true,minify:true,format:"iife",target:["es2022"],legalComments:"eof"};
await build({...options,outfile:"web/raid-arena.js",define:{__RAID_OFFLINE_MODELS__:"null"}});
// Offline preview embeds the same verified models so opening an HTML file needs no server.
const models=Object.fromEntries(keys.map(key=>[key,`data:model/gltf-binary;base64,${fs.readFileSync(`web/assets/raid-3d/nordic-models/${key}.glb`).toString("base64")}`]));
for(const variant of ["knight","ranger","mage"])models[`party-${variant}`]=`data:model/gltf-binary;base64,${fs.readFileSync(`web/assets/raid-3d/nordic-heroes/${variant}.glb`).toString("base64")}`;
for(const texture of ["stone","paving"])models[`texture-${texture}`]=`data:image/jpeg;base64,${fs.readFileSync(`web/assets/raid-3d/nordic-textures/${texture}.jpg`).toString("base64")}`;
await build({...options,outfile:"web/raid-arena-preview.js",define:{__RAID_OFFLINE_MODELS__:JSON.stringify(models)}});
console.log("3D battlefield and offline preview built.");
