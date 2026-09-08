import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import * as T from "three";
import { createEffects } from "../web/raid-arena-effects.js";
import { partyFormation, clearGroup, participantName } from "../web/raid-arena-source.js";

const keys=["leviathan","sentinel","prism","zero-core","warden","overmind","behemoth","singularity"];
test("battlefield labels prefer leaderboard nicknames and never raw identity fields",()=>{
  assert.equal(participantName({maskedName:"星河***长夜",maskedId:"ID · **AB12"}),"星河***长夜");
  assert.equal(participantName({maskedId:"ID · **AB12"}),"**AB12");
  assert.equal(participantName({userId:"12345",username:"secret",name:"private",email:"private@example.com"}),"");
});
test("scene cleanup releases instanced foliage buffers and shared resources once",()=>{
  const group=new T.Group(),geometry=new T.IcosahedronGeometry(1),map=new T.Texture(),material=new T.MeshStandardMaterial({map,bumpMap:map});
  const events={instance:0,geometry:0,material:0,texture:0};
  for(let i=0;i<8;i++){const tree=new T.InstancedMesh(geometry,material,48);tree.addEventListener("dispose",()=>events.instance++);group.add(tree);}
  geometry.addEventListener("dispose",()=>events.geometry++);material.addEventListener("dispose",()=>events.material++);map.addEventListener("dispose",()=>events.texture++);
  clearGroup(group);
  assert.deepEqual(events,{instance:8,geometry:1,material:1,texture:1});assert.equal(group.children.length,0);
});
test("party fills ground X columns then next Z row, keeping every hero on the island",()=>{
  for(const width of [320,390,650,651,768,1440]){
    const columns=width<=650?2:3;
    for(const count of [0,1,4,6]){
      const slots=partyFormation(width,count);assert.equal(slots.length,count);
      slots.forEach((p,i)=>{
        assert.equal(p.y,.125);assert.ok(p.x>0&&p.x<6);assert.ok(p.z>-3&&p.z<3);
        if(i%columns){assert.equal(p.z,slots[i-1].z);assert.ok(p.x>slots[i-1].x);}
        else if(i){assert.equal(p.x,slots[0].x);assert.ok(p.z>slots[i-1].z);}
      });
    }
  }
});
test("party uses three adult-proportion independently animatable medieval heroes",()=>{
  for(const key of ["knight","ranger","mage"]){
    const b=fs.readFileSync(new URL(`../web/assets/raid-3d/nordic-heroes/${key}.glb`,import.meta.url));
    assert.equal(b.toString("utf8",0,4),"glTF");assert.equal(b.readUInt32LE(8),b.length);
    const json=JSON.parse(b.toString("utf8",20,20+b.readUInt32LE(12)).trim());
    assert.ok(json.skins.some(skin=>skin.joints.length>=30));
    assert.ok(json.meshes.length>=1,"authored textured character must be included");
    assert.deepEqual(json.animations.map(a=>a.name).sort(),["Attack","Hit","Idle"]);
    assert.ok(json.buffers.every(a=>!a.uri));assert.ok(json.images.every(a=>!a.uri&&Number.isInteger(a.bufferView)));
  }
  assert.ok(fs.existsSync(new URL("../web/assets/raid-3d/nordic-heroes/CREDITS.md",import.meta.url)));
});
test("all eight northern bosses use distinct self-contained authored models",()=>{
  const buffers=new Set();
  for(const key of keys){
    const b=fs.readFileSync(new URL(`../web/assets/raid-3d/nordic-models/${key}.glb`,import.meta.url));
    assert.equal(b.toString("utf8",0,4),"glTF");assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);
    const json=JSON.parse(b.toString("utf8",20,20+b.readUInt32LE(12)).trim());
    if(key!=="prism")assert.ok(json.skins.length>0,key);
    assert.ok(json.meshes.length>0,key);
    // Native clips differ across the licensed sources. Missing hit/death uses
    // the renderer's recoil/seal disappearance, checked in the browser workflow.
    if(key==="leviathan")assert.ok(json.animations.some(a=>a.name==="Death"));
    assert.ok(json.buffers.every(a=>!a.uri),"GLB buffer must be local");
    assert.ok(json.images.every(a=>!a.uri&&Number.isInteger(a.bufferView)),"textures must be embedded");
    buffers.add(b.toString("base64"));
  }
  assert.equal(buffers.size,8);
});

test("shipped 3D bundle matches the source and contains no preview models",async()=>{
  const result=await build({entryPoints:["web/raid-arena-source.js"],bundle:true,minify:true,format:"iife",target:["es2022"],legalComments:"eof",write:false,define:{__RAID_OFFLINE_MODELS__:"null"}});
  const shipped=fs.readFileSync(new URL("../web/raid-arena.js",import.meta.url),"utf8");
  assert.equal(shipped,result.outputFiles[0].text,"run npm run build:raid-3d after editing renderer");
  assert.ok(shipped.length<900000,"production bundle should not contain the embedded model preview");
});

test("effects keep bounded resources, expire and clear when disabled or changing scenes",(t)=>{
  const original=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})};
  t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
  const scene=new T.Scene(),effects=createEffects(scene);
  effects.setTheme({kind:"lava",accent:0xff9944});
  const children=effects.group.children.slice();
  const points=children.filter(n=>n.isPoints), sparks=points[1];
  assert.equal(points[0].geometry.attributes.position.count,72);
  assert.equal(sparks.geometry.attributes.position.count,96);
  for(let i=0;i<1000;i++){effects.launch(new T.Vector3(3,.2,1));effects.impact();}
  assert.deepEqual(effects.group.children,children,"one sync cannot grow the GPU object pool");
  assert.equal(children.filter(n=>n.isLine&&n.visible).length,6);
  const source=new T.Vector3(6,.18,.65);
  for(let i=0;i<6;i++)effects.launch(source);
  for(const trail of children.filter(n=>n.isLine)){
    const positions=trail.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      assert.ok(Math.abs(positions.getX(i)-source.x)<1e-6);
      assert.ok(Math.abs(positions.getY(i)-source.y)<1e-6);
      assert.ok(Math.abs(positions.getZ(i)-source.z)<1e-6,"reused trails start at the new contributor immediately");
    }
  }
  for(let i=0;i<100;i++)effects.tick(.05,i*.05);
  assert.equal(sparks.visible,false);
  assert.equal(children.filter(n=>n.isLine&&n.visible).length,0);
  assert.equal(children.find(n=>n.isPointLight).intensity,0);
  effects.victory();assert.equal(sparks.visible,true);
  effects.setEnabled(false);effects.impact();assert.equal(effects.group.visible,false);assert.equal(sparks.visible,false);
  effects.setEnabled(true);effects.setActive(false);effects.launch(new T.Vector3());effects.impact();assert.equal(sparks.visible,false);
  effects.setActive(true);effects.impact();effects.setTheme({kind:"ice",accent:0xaddaff});
  assert.equal(sparks.visible,false);assert.equal(children.filter(n=>n.isLine&&n.visible).length,0);
  for(let i=0;i<96;i++)assert.equal(sparks.geometry.attributes.position.getY(i),-20);
  for(const geometry of new Set(children.map(n=>n.geometry).filter(Boolean)))geometry.dispose();
  const materials=new Set(children.map(n=>n.material).filter(Boolean));points[0].material.map.dispose();for(const m of materials)m.dispose();
});
