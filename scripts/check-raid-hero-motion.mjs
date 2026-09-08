import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

// Exercise the real actor loader, animations and damage path with a deterministic clock.
// Instrumentation lives only in this in-memory verification bundle.
const root=path.resolve(".");
const source=fs.readFileSync("web/raid-arena-source.js","utf8").replace(
  "renderer.render(scene,camera);",
  "scene.updateMatrixWorld(true);globalThis.__motionParty=party;globalThis.__motionBoss={gltf,modelRoot,bounds:()=>new T.Box3().setFromObject(modelRoot,true)};"
);
const models={};
for(const key of ["leviathan","sentinel","prism","zero-core","warden","overmind","behemoth","singularity"]){
  models[key]=`data:model/gltf-binary;base64,${fs.readFileSync(`web/assets/raid-3d/nordic-models/${key}.glb`).toString("base64")}`;
}
for(const key of ["knight","ranger","mage"]){
  models[`party-${key}`]=`data:model/gltf-binary;base64,${fs.readFileSync(`web/assets/raid-3d/nordic-heroes/${key}.glb`).toString("base64")}`;
}
for(const name of ["stone","paving"])models[`texture-${name}`]=`data:image/jpeg;base64,${fs.readFileSync(`web/assets/raid-3d/nordic-textures/${name}.jpg`).toString("base64")}`;
const result=await build({stdin:{contents:source,resolveDir:path.join(root,"web")},bundle:true,format:"iife",write:false,define:{__RAID_OFFLINE_MODELS__:JSON.stringify(models)}});
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>{
    let id=0,time=0;
    const callbacks=new Map();
    window.requestAnimationFrame=fn=>{callbacks.set(++id,fn);return id;};
    window.cancelAnimationFrame=id=>callbacks.delete(id);
    window.advanceMotion=(frames,step=1000/60)=>{
      for(let i=0;i<frames;i++){
        time+=step;
        const batch=[...callbacks.values()];callbacks.clear();
        for(const fn of batch)fn(time);
      }
    };
  });
  await page.route("**/raid-arena-preview.js",route=>route.fulfill({contentType:"application/javascript; charset=utf-8",body:result.outputFiles[0].text}));
  await page.goto(pathToFileURL(path.join(root,"web/boss-raid-animation-preview.html")).href);
  await page.waitForFunction(()=>globalThis.__motionParty?.length===6&&__motionParty.every(p=>p.actor),{},{polling:25});
  await page.evaluate(()=>{
    globalThis.captureHeroPoses=()=>__motionParty.map(p=>{
      const bones=[];p.actor.traverse(n=>{if(n.isBone)bones.push([...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()]);});
      return {root:p.root.position.toArray(),bones};
    });
    advanceMotion(1);
  });
  const standing=await page.evaluate(()=>captureHeroPoses());
  await page.evaluate(()=>advanceMotion(150)); // Longer than every former idle loop.
  assert.deepEqual(await page.evaluate(()=>captureHeroPoses()),standing,"no consumption: all six heroes must remain still");
  assert.deepEqual(await page.locator(".raid-member-label b").allTextContents(),await page.evaluate(()=>participants.map(p=>p.maskedName)));
  // The displayed name may change or collide; the enrollment still owns its actor.
  await page.evaluate(()=>{
    globalThis.originalActors=__motionParty.map(p=>p.actor);
    globalThis.drawnNames=[];
    const proto=CanvasRenderingContext2D.prototype,fill=proto.fillText;
    proto.fillText=function(text,...args){drawnNames.push(text);return fill.call(this,text,...args);};
    participants[0].maskedName=participants[1].maskedName="星河***长夜";draw();advanceMotion(2);
  });
  assert.equal(await page.evaluate(()=>__motionParty.every((p,i)=>p.actor===originalActors[i])),true,"renaming cannot recreate characters");
  assert.deepEqual(await page.locator(".raid-member-label b").allTextContents(),await page.evaluate(()=>participants.map(p=>p.maskedName)));
  assert.ok(await page.evaluate(()=>drawnNames.filter(n=>n==="星河***长夜").length===2),"both world textures must redraw the leaderboard nickname");
  assert.deepEqual(await page.evaluate(()=>captureHeroPoses()),standing,"nickname changes cannot generate attacks");

  // First three slots contain ranger, mage and knight; identical templates must not
  // cause their other instances to animate along with the real contributor.
  for(let i=0;i<3;i++){
    await page.evaluate(index=>{
      participants[index].damage+=12;boss.totalDamage+=12;boss.remainingHealth-=12;
      draw();visual.hit();advanceMotion(7);
    },i);
    const attacking=await page.evaluate(()=>captureHeroPoses());
    assert.ok((await page.locator(".raid-attack-note").textContent()).includes(await page.evaluate(i=>participants[i].maskedName,i)),"attack notices use the same nickname");
    assert.notDeepEqual(attacking[i],standing[i],`contributor ${i} must play the attack`);
    for(let j=0;j<6;j++)if(j!==i)assert.deepEqual(attacking[j],standing[j],`non-contributor ${j} must stay still`);
    await page.evaluate(()=>advanceMotion(70));
    assert.deepEqual(await page.evaluate(()=>captureHeroPoses()),standing,"completed attack must restore the fixed standing pose");
    await page.evaluate(()=>{draw();advanceMotion(150);});
    assert.deepEqual(await page.evaluate(()=>captureHeroPoses()),standing,"identical refresh must not restart idle or attack");
  }

  await page.evaluate(()=>{
    participants[0].damage+=12;draw();advanceMotion(5);visual.setPaused(true);
  });
  const paused=await page.evaluate(()=>captureHeroPoses());
  await page.evaluate(()=>advanceMotion(90));
  assert.deepEqual(await page.evaluate(()=>captureHeroPoses()),paused,"pause must freeze the in-flight attack");
  await page.evaluate(()=>{visual.setPaused(false);advanceMotion(70);});
  assert.deepEqual(await page.evaluate(()=>captureHeroPoses()),standing,"resumed attack must finish at rest");
  await page.evaluate(()=>{
    participants[1].damage+=12;draw();advanceMotion(4);visual.setReducedMotion(true);advanceMotion(150);
  });
  assert.deepEqual(await page.evaluate(()=>captureHeroPoses()),standing,"reducing motion must restore the standing pose");
  // Verify actual native and fallback death paths with the same controllable
  // clock; the separate visual check still renders every boss and environment.
  const deathModes={};
  await page.evaluate(()=>{
    visual.setReducedMotion(false);globalThis.bossDeaths=0;
    document.querySelector("#preview-boss").addEventListener("raid-boss-defeated",()=>globalThis.bossDeaths++);
  });
  for(const key of Object.keys(models).filter(k=>!k.startsWith("party-")&&!k.startsWith("texture-"))){
    await page.evaluate(key=>select(key),key);
    await page.waitForFunction(key=>document.querySelector("#preview-boss").dataset.model===key,key,{polling:25});
    const bounds=await page.evaluate(()=>{
      advanceMotion(1);const b=__motionBoss.bounds();return {min:b.min.toArray(),max:b.max.toArray()};
    });
    assert.ok([...bounds.min,...bounds.max].every(Number.isFinite),`${key} posed bounds must be finite`);
    const expectedGround=.125+await page.evaluate(key=>RaidArena.scenes[key].elevation||0,key);
    assert.ok(Math.abs(bounds.min[1]-expectedGround)<(key==="singularity"?.09:.025),`${key} must match its ground or hover height, got ${bounds.min[1]}`);
    await page.evaluate(()=>{
      bossDeaths=0;visual.setPaused(true);boss.status="defeated";draw();advanceMotion(600);
    });
    assert.equal(await page.evaluate(()=>bossDeaths),0,`${key} paused defeat must wait`);
    const mode=await page.evaluate(()=>{
      visual.setPaused(false);advanceMotion(81,100);return document.querySelector("#preview-boss").dataset.deathMode;
    });
    deathModes[key]=mode;
    assert.equal(await page.evaluate(()=>bossDeaths),1,`${key} must complete defeat once within 8s even at 10fps`);
    if(mode==="dissolve"){
      assert.equal(await page.evaluate(()=>__motionBoss.modelRoot.visible),false,`${key} must also stop casting a shadow after disappearing`);
      assert.equal(await page.evaluate(()=>{
        let visible=false;__motionBoss.gltf.scene.traverse(n=>{for(const m of n.material?[].concat(n.material):[])if(m.opacity>0)visible=true;});return visible;
      }),false,`${key} without native Death must disappear fully`);
    }
    await page.evaluate(()=>{draw();advanceMotion(120);});
    assert.equal(await page.evaluate(()=>bossDeaths),1,`${key} repeat data must not replay defeat`);
    await page.evaluate(()=>{boss.status="active";boss.remainingHealth=2000;draw();advanceMotion(1);});
    if(mode==="dissolve")assert.ok(Math.abs(await page.evaluate(()=>__motionBoss.bounds().min.y)-expectedGround)<(key==="singularity"?.09:.025),`${key} preview reset must restore placement`);
    await page.evaluate(()=>{bossDeaths=0;visual.setReducedMotion(true);boss.status="defeated";draw();});
    assert.equal(await page.evaluate(()=>bossDeaths),1,`${key} reduced motion must complete without waiting for a frame`);
    await page.evaluate(()=>visual.setReducedMotion(false));
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({heroesAtRest:6,individualAttackTypes:3,returnsToRest:true,noRefreshReplay:true,pauseAndReducedMotion:true,bossDeathModes:deathModes,errors}));
} finally {await browser.close();}
