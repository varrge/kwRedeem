import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { build } from "esbuild";

const root=path.resolve(".");
// Instrument only this in-memory test bundle; production never exposes scene internals.
const instrumented=fs.readFileSync(path.join(root,"web/raid-arena-source.js"),"utf8").replace("renderer.render(scene,camera);","globalThis.__raidWorld={scene,camera,party,effects};renderer.render(scene,camera);").replace("effects.launch(origin)","(globalThis.__raidShot={origin:origin.toArray(),hand:member.hand.getWorldPosition(new T.Vector3()).toArray(),id:member.member.publicId},effects.launch(origin))");
const testBundle=await build({stdin:{contents:instrumented,resolveDir:path.join(root,"web"),sourcefile:"raid-world-check.js"},bundle:true,format:"iife",write:false,define:{__RAID_OFFLINE_MODELS__:"null"}});
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(12000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root,"web/boss-raid-animation-preview.html")).href);
  const keys=await page.evaluate(()=>Object.keys(RaidArena.scenes));
  const output=path.join(root,"output/raid-3d");fs.mkdirSync(output,{recursive:true});
  for(const key of keys){
    await page.locator(`[data-boss="${key}"]`).click();
    await page.waitForFunction(key=>document.querySelector("#preview-boss").dataset.model===key,key);
    await page.waitForFunction(()=>document.querySelectorAll("[data-actor-ready='true']").length===6);
    await page.waitForFunction(()=>document.querySelector("#preview-boss").dataset.environmentReady==="true");
    assert.equal(await page.locator(".raid-member-label").count(),6);
    for(const label of await page.locator(".raid-member-label b").allTextContents())assert.match(label,/^\*\*[A-F0-9]{4}$/);
    await page.locator("#attacker").selectOption("demo-enrollment-2");
    await page.locator("#hit").click();
    await page.waitForFunction(()=>document.querySelector("#preview-boss").dataset.animation==="HitReact");
    assert.deepEqual(await page.locator(".raid-member-label.is-attacking b").allTextContents(),["**A8B3"],"only the selected consumer attacks");
    assert.deepEqual(await page.evaluate(()=>participants.map(p=>p.damage)),[0,0,12,0,0,0],"10 simulated credits at1.2x belong only to the selected player");
    await page.locator("#health").fill("20");assert.equal(await page.locator("#preview-boss").getAttribute("data-state"),"enraged");
    await page.locator("#health").fill("0");assert.equal(await page.locator("#preview-boss").getAttribute("data-state"),"unstable");
    await page.evaluate(()=>{
      globalThis.deathEvents=0;const host=document.querySelector("#preview-boss");
      if(globalThis.deathHandler)host.removeEventListener("raid-boss-defeated",globalThis.deathHandler);
      globalThis.deathHandler=()=>globalThis.deathEvents++;host.addEventListener("raid-boss-defeated",globalThis.deathHandler);
    });
    await page.locator("#defeat").click();await page.waitForFunction(()=>globalThis.deathEvents===1);
    assert.ok(["native","dissolve"].includes(await page.locator("#preview-boss").getAttribute("data-death-mode")));
    await page.evaluate(()=>draw());await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>globalThis.deathEvents),1,"repeated defeated snapshot cannot repeat completion");
    await page.locator("#reset").click();await page.waitForFunction(key=>document.querySelector("#preview-boss").dataset.model===key,key);
    await page.waitForFunction(()=>document.querySelectorAll("[data-actor-ready='true']").length===6);await page.locator("#motion").click();
    const first=await page.locator("#preview-boss canvas").screenshot();await page.waitForTimeout(120);
    assert.ok(first.equals(await page.locator("#preview-boss canvas").screenshot()),"paused canvas must stay still");
    await page.screenshot({path:path.join(output,`${key}.png`),fullPage:true});
    await page.locator("#motion").click();
  }
  assert.equal(await page.getByRole("button",{name:"下一页参战者"}).isDisabled(),true);
  // Camera controls remain user-driven while animation is paused.
  await page.locator("#motion").click();
  const canvas=page.locator("#preview-boss canvas"),box=await canvas.boundingBox();
  const initial=await canvas.screenshot();
  await page.mouse.move(box.x+box.width*.45,box.y+box.height*.57);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.8,box.y+box.height*.48,{steps:15});await page.mouse.up();
  assert.ok(!initial.equals(await canvas.screenshot()),"mouse drag must orbit the scene");
  await page.getByRole("button",{name:"复位视角"}).click();
  assert.ok(initial.equals(await canvas.screenshot()),"reset restores the initial view exactly");
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.6);await page.mouse.wheel(0,-180);
  assert.ok(!initial.equals(await canvas.screenshot()),"wheel zoom must change the camera");
  await page.getByRole("button",{name:"复位视角"}).click();await page.locator("#motion").click();
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelectorAll(".raid-member-label").length===6);
  await page.locator("#motion").click();
  const mobileBox=await canvas.boundingBox(),touchBefore=await canvas.screenshot();
  const cdp=await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:mobileBox.width*.4,y:mobileBox.y+mobileBox.height*.55}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:mobileBox.width*.8,y:mobileBox.y+mobileBox.height*.48}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  assert.ok(!touchBefore.equals(await canvas.screenshot()),"touch drag must orbit on mobile");
  await page.getByRole("button",{name:"复位视角"}).click();await page.locator("#motion").click();
  await page.screenshot({path:path.join(output,"mobile.png"),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Exercise production against in-memory fixtures, never an external account or API.
  const participants=Array.from({length:60},(_,i)=>({publicId:`opaque-test-${i}`,maskedId:`ID · **${(0xD000+i).toString(16).toUpperCase()}`,damage:i*.25,own:i===59}));
  let fixtureCount=60,assetKey="leviathan";
  const calls=[];
  await page.route("https://raid.test/**",async route=>{
    const pathname=new URL(route.request().url()).pathname;calls.push(pathname);
    if(pathname.startsWith("/api/")){
      const boss={id:assetKey,assetKey,name:"首领测试",sequence:1,level:1,status:"active",health:2000,remainingHealth:1800,totalDamage:200,entryCostThreshold:10,themeMultiplier:1.2,clearReward:{name:"全站充值",type:"global_recharge_multiplier",rechargeMultiplier:1.02},mvpRewards:[]};
      return route.fulfill({json:{sessionToken:"test",campaign:{id:"fixture-campaign",name:"九月 PVE",rewardMode:"pve",status:"active",bosses:[boss]},currentBoss:boss,participants:participants.slice(0,fixtureCount),participantCount:fixtureCount,effectiveRaiderCount:10,enrollment:{},ranking:[],battleLog:[],history:[],rewards:[],sync:null}});
    }
    if(pathname==="/runtime-config.js")return route.fulfill({contentType:"application/javascript",body:'window.KAWANG_CONFIG={apiUrl:""}'});
    if(pathname==="/raid-arena.js")return route.fulfill({contentType:"application/javascript; charset=utf-8",body:testBundle.outputFiles[0].text});
    const file=path.join(root,"web",pathname);
    if(!fs.existsSync(file))return route.fulfill({status:404,body:""});
    return route.fulfill({body:fs.readFileSync(file),contentType:pathname.endsWith(".html")?"text/html":pathname.endsWith(".css")?"text/css":pathname.endsWith(".glb")?"model/gltf-binary":pathname.endsWith(".jpg")?"image/jpeg":"application/javascript"});
  });
  for(const width of [320,390,650,660,768,980,1024,1440]){
    await page.setViewportSize({width,height:900});
    await page.goto("https://raid.test/sub2api-raid.html?connectionId=fixture&token=test&ui_mode=embedded");
    await page.waitForFunction(()=>document.querySelector("#boss-scene").dataset.model==="leviathan");
    await page.waitForFunction(()=>document.querySelectorAll("[data-actor-ready='true']").length===6);
    await page.waitForFunction(()=>document.querySelector("#boss-scene").dataset.environmentReady==="true");
    assert.equal(await page.locator(".raid-member-label").count(),6,`${width}px must retain six people`);
    assert.equal(await page.locator(".raid-party-grid,.raid-member-view").count(),0,"no UI character cards or separate viewports");
    const world=await page.evaluate(()=>{
      const {scene,party}=__raidWorld;
      return party.map(p=>{let top=p.actor;while(top.parent)top=top.parent;const meshes=[];p.actor.traverse(n=>{if(n.isMesh)meshes.push(n);});
        return {position:p.root.position.toArray(),sameScene:top===scene,shadows:meshes.every(n=>n.castShadow&&n.receiveShadow),identityOnGround:p.identity.parent===p.root,groundText:p.identity.material.map.image instanceof HTMLCanvasElement};});
    });
    const columns=width<=650?2:3;
    world.forEach((member,i)=>{
      assert.equal(member.sameScene,true);assert.equal(member.shadows,true);assert.equal(member.identityOnGround,true);assert.equal(member.groundText,true);assert.equal(member.position[1],.125);
      if(i%columns){assert.ok(member.position[0]>world[i-1].position[0]);assert.equal(member.position[2],world[i-1].position[2]);}
      else if(i){assert.equal(member.position[0],world[0].position[0]);assert.ok(member.position[2]>world[i-1].position[2]);}
    });
    const dimensions=await page.evaluate(()=>({field:document.querySelector("#battlefield").getBoundingClientRect().bottom,button:document.querySelector("#enroll-btn").getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.ok(dimensions.button<=dimensions.field,JSON.stringify(dimensions));assert.equal(dimensions.overflow,false);
    const projection=await page.evaluate(()=>{const {party,camera}=__raidWorld;return party.map(p=>p.root.position.clone().project(camera).toArray());});
    assert.ok(projection.every(p=>p.every(Number.isFinite)&&Math.abs(p[0])<1&&Math.abs(p[1])<1),`ground party inside camera at ${width}`);
    await page.screenshot({path:path.join(output,`production-${width}.png`),fullPage:true});
  }
  fixtureCount=0;await page.locator("#refresh-btn").click();await page.waitForFunction(()=>document.querySelectorAll(".raid-member-label").length===0);assert.match(await page.locator(".raid-party-toolbar strong").textContent(),/等待/);
  fixtureCount=60;await page.locator("#refresh-btn").click();await page.waitForFunction(()=>document.querySelectorAll("[data-actor-ready='true']").length===6);
  const attackLabels=()=>page.locator(".raid-member-label.is-attacking b").allTextContents();
  assert.deepEqual(await attackLabels(),[],"first snapshot never fabricates historical attacks");
  // The production bootstrap can change individual totals without battle-log IDs changing.
  participants[2].damage+=12;
  await page.locator("#refresh-btn").click();
  await page.waitForFunction(()=>document.querySelector(".raid-member-label.is-attacking b")?.textContent==="**D002");
  assert.deepEqual(await attackLabels(),["**D002"]);
  const shot=await page.evaluate(()=>__raidShot);assert.equal(shot.id,"opaque-test-2");assert.deepEqual(shot.origin,shot.hand,"beam must start at the attacker's actual world hand, not a screen card");
  await page.waitForFunction(()=>document.querySelectorAll(".raid-member-label.is-attacking").length===0);
  await page.locator("#refresh-btn").click();await page.waitForTimeout(150);assert.deepEqual(await attackLabels(),[],"identical snapshot must not replay an attack");
  participants[2].damage-=1;await page.locator("#refresh-btn").click();await page.waitForTimeout(150);assert.deepEqual(await attackLabels(),[],"negative corrections must not attack");
  participants[1].damage+=1;participants[4].damage+=3;
  await page.locator("#refresh-btn").click();await page.waitForFunction(()=>document.querySelectorAll(".raid-member-label.is-attacking").length===2);
  assert.deepEqual(await attackLabels(),["**D001","**D004"],"two contributors do not make a six-person volley");
  await page.waitForTimeout(1000);
  participants[8].damage+=2;participants[14].damage+=4;
  await page.locator("#refresh-btn").click();
  await page.waitForFunction(()=>document.querySelector(".raid-member-label.is-attacking b")?.textContent==="**D008");
  assert.deepEqual(await attackLabels(),["**D008"],"off-page contributor must fire from its own model");
  await page.waitForFunction(()=>document.querySelector(".raid-member-label.is-attacking b")?.textContent==="**D00E");
  assert.deepEqual(await attackLabels(),["**D00E"]);
  await page.waitForTimeout(1000);await page.locator("#refresh-btn").click();await page.waitForTimeout(150);assert.deepEqual(await attackLabels(),[]);
  for(let i=0;i<2;i++)await page.getByRole("button",{name:"上一页参战者"}).click();
  for(let i=0;i<9;i++)await page.getByRole("button",{name:"下一页参战者"}).click();assert.equal(await page.locator(".raid-member-label.is-own").count(),1);
  assert.ok(calls.every(url=>!url.includes("avatar")&&!url.includes("gravatar")));
  await page.emulateMedia({reducedMotion:"reduce"});const paused=await page.locator("#boss-scene canvas").screenshot();await page.waitForTimeout(120);assert.ok(paused.equals(await page.locator("#boss-scene canvas").screenshot()));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({models:keys.length,licensedHeroes:3,worldGridFormation:true,singleSceneAndCamera:true,castShadows:true,sixPeople:true,individualAttacks:true,crossPageAttacks:true,noReplay:true,mouseOrbit:true,touchOrbit:true,zoomAndReset:true,participantPrivacy:true,pagination:true,emptyState:true,paused:true,embeddedWidths:[320,390,650,660,768,980,1024,1440],errors}));
} finally { await browser.close(); }
