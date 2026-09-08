import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { createEffects } from "./raid-arena-effects.js";
import { buildNordicEnvironment } from "./raid-nordic-environment.js";

const scenes = Object.freeze({
  leviathan: { name: "霜脊古堡", title: "黑棘 · 利维坦", kind: "lava", sky: 0x34444c, ground: 0x727978, accent: 0xc7a575, haze: 0x8ea9b3 },
  sentinel: { name: "寒松遗迹", title: "古誓戟卫", kind: "forest", sky: 0x334642, ground: 0x66756b, accent: 0xb4b798, haze: 0x91b1a8 },
  prism: { name: "枯金矿坑", title: "巢穴之母", kind: "hive", secondaryMotion:"breathe", sky: 0x454740, ground: 0x7c7566, accent: 0xc7b080, haze: 0xb1a58a },
  "zero-core": { name: "黑曜祭所", title: "黑曜翼魔", kind: "lab", maxHeight:2.4, sky: 0x34464b, ground: 0x657370, accent: 0x9ebbb3, haze: 0x7eacae },
  warden: { name: "灰石要塞", title: "灰鬃处刑者", kind: "fortress", sky: 0x3c4146, ground: 0x777671, accent: 0xc6a58b, haze: 0x9ba6ab },
  overmind: { name: "腐沼墓园", title: "幽沼主宰", kind: "swamp", sky: 0x34443e, ground: 0x65716a, accent: 0xb7b095, haze: 0x8ca59e },
  behemoth: { name: "冰封隘口", title: "霜牙三首猎犬", kind: "ice", sky: 0x4a5e69, ground: 0xa9b8b8, accent: 0xc1d6d9, haze: 0xb0cbd7 },
  singularity: { name: "沉星祭坛", title: "深渊凝视者", kind: "astral", elevation:.8, maxHeight:2.6, secondaryMotion:"hover", sky: 0x383e50, ground: 0x767887, accent: 0xafaeca, haze: 0x9099be }
});

const credits=Object.freeze(Object.fromEntries(Object.entries({
  leviathan:["Drummyfish / Cethiel","CC0 1.0","publicdomain/zero/1.0"],
  sentinel:["Danimal / Anthony Myers / Konstantin Maystrenko","CC BY 3.0","licenses/by/3.0"],
  prism:["esbxp","CC BY 4.0","licenses/by/4.0"],
  "zero-core":["Clement Wu / Nikolaus / Botanic","CC BY 3.0","licenses/by/3.0"],
  warden:["Clement Wu / Nikolaus / Botanic","CC BY 3.0","licenses/by/3.0"],
  overmind:["Eldritch Grim","CC0 1.0","publicdomain/zero/1.0"],
  behemoth:["Clement Wu / Nikolaus / Botanic","CC BY 3.0","licenses/by/3.0"],
  singularity:["Grefuntor / Atmostatic","CC BY 3.0","licenses/by/3.0"]
}).map(([key,[credit,license,licensePath]])=>[key,{credit,license,licenseUrl:`https://creativecommons.org/${licensePath}/`,source:`./assets/raid-3d/nordic-models/${key==="leviathan"?"CREDITS.md":`${key}.credits.md`}`}])));

export function participantName(participant) {
  // The leaderboard's server-masked nickname is also the battlefield label.
  // Keep old snapshots usable while the API and cached pages roll forward.
  if(typeof participant.maskedName==="string"&&participant.maskedName.trim()&&participant.maskedName.length<=64)return participant.maskedName;
  return /^ID · \*\*[A-F0-9]{4}$/.test(participant.maskedId)?participant.maskedId.replace("ID · ",""):"";
}

// Fill X slots on the right-hand ground, then start the next Z row.
export function partyFormation(width, count) {
  const columns=width<=650?2:3;
  return Array.from({length:count},(_,index)=>({
    x:columns===2?2.1+(index%columns)*2.3:1.25+(index%columns)*1.9,
    y:.125,
    z:columns===2?-2.35+Math.floor(index/columns)*2.35:-1.95+Math.floor(index/columns)*3.8
  }));
}

export function clearGroup(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  group.traverse((node) => {
    if (node.isInstancedMesh) node.dispose();
    if (node.geometry) geometries.add(node.geometry);
    if (node.skeleton) skeletons.add(node.skeleton);
    for (const material of node.material ? [].concat(node.material) : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const resource of [...geometries, ...materials, ...textures, ...skeletons]) resource.dispose();
  group.clear();
}

function create(host) {
  // Keep the existing sprite presentation for environments without WebGL.
  const fallbackFactory=globalThis.RaidBoss?.create;
  let renderer;
  try { renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:"low-power"}); }
  catch { return fallbackFactory?.(host) || null; }
  const scene=new T.Scene();
  const camera=new T.PerspectiveCamera(36,1,.1,120);
  const canvas=renderer.domElement;canvas.className="raid-3d-canvas";canvas.setAttribute("aria-hidden","true");
  host.replaceChildren(canvas);host.classList.add("raid-arena");host.dataset.renderer="3d";
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  const hemi=new T.HemisphereLight(0xadc7d8,0x34342d,1.7);scene.add(hemi);
  const sun=new T.DirectionalLight(0xdfebf5,2.7);sun.position.set(-8,12,7);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
  Object.assign(sun.shadow.camera,{left:-10,right:10,top:8,bottom:-8,near:1,far:35});sun.shadow.normalBias=.04;scene.add(sun);
  const rim=new T.DirectionalLight(0xa9caff,1.15);rim.position.set(1,5,-6);scene.add(rim);
  const modelRoot=new T.Group();modelRoot.position.set(-3.1,.125,0);scene.add(modelRoot);
  const partyRoot=new T.Group();partyRoot.name="raid-party-world";scene.add(partyRoot);
  const effects=createEffects(scene);
  const controls=new OrbitControls(camera,canvas);controls.target.set(0,.8,0);controls.cursor.copy(controls.target);
  controls.enableDamping=false;controls.minPolarAngle=.35;controls.maxPolarAngle=1.25;controls.maxTargetRadius=2.5;
  controls.rotateSpeed=.7;controls.zoomSpeed=.8;controls.panSpeed=.6;
  let environment=null, gltf=null, mixer=null, action=null, boss=null, revision=0;
  let disposed=false, contextLost=false, pause=false, reduced=false, visible=true, frame=null, last=null, elapsed=0;
  let state="idle", deathComplete=false, hitRemaining=0, homeDistance=0;
  let deathProgress=null, returnToBossRest=false;
  let bossMaterials=[];
  const pageSize=6;
  let participants=[], participantCount=0, page=0, campaignId=null, lastDamage=new Map();
  let partyGeneration=0;
  const actorTemplates=new Map();
  const pendingAttacks=new Map();
  let attackPageRemaining=0;
  const party=[];
  const labels=document.createElement("div");labels.className="raid-party-identities";labels.setAttribute("aria-label","场景内参战者");host.append(labels);
  const toolbar=document.createElement("div");toolbar.className="raid-party-toolbar";
  const heading=document.createElement("strong"), status=document.createElement("span"), previous=document.createElement("button"), next=document.createElement("button");
  heading.textContent="参战小队";previous.type=next.type="button";previous.textContent="‹";next.textContent="›";previous.setAttribute("aria-label","上一页参战者");next.setAttribute("aria-label","下一页参战者");
  toolbar.append(heading,previous,status,next);host.append(toolbar);
  const rosterNote=document.createElement("span");rosterNote.className="raid-roster-note";toolbar.append(rosterNote);
  const attackNote=document.createElement("div");attackNote.className="raid-attack-note";attackNote.setAttribute("role","status");host.append(attackNote);
  const viewToolbar=document.createElement("div");viewToolbar.className="raid-view-toolbar";
  const viewHint=document.createElement("span");viewHint.textContent="拖动旋转 · 滚轮 / 双指缩放";
  const resetView=document.createElement("button");resetView.type="button";resetView.textContent="复位视角";viewToolbar.append(viewHint,resetView);host.append(viewToolbar);
  const sceneTag=document.createElement("div");sceneTag.className="raid-scene-tag";host.append(sceneTag);
  const message=document.createElement("div");message.className="raid-model-message";message.setAttribute("role","status");host.append(message);
  const retry=document.createElement("button");retry.type="button";retry.textContent="重试加载 Boss";retry.hidden=true;message.append(retry);
  const motion=window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const loader=new GLTFLoader();
  function disabledMotion(){return reduced || Boolean(motion?.matches);}
  function running(){return !disposed&&!contextLost&&!pause&&visible&&!document.hidden&&!disabledMotion();}
  function render(){
    if(disposed||contextLost)return;
    const textScale=2*Math.tan(T.MathUtils.degToRad(camera.fov/2))/Math.max(1,host.clientHeight);
    for(const member of party){const height=(host.clientWidth<=650?15:19)*textScale;member.identity.scale.set(height*member.identity.material.map.image.width/48,height,1);}
    renderer.render(scene,camera);
  }
  function schedule(){if(frame===null&&running())frame=requestAnimationFrame(tick);}
  function stop(){if(frame!==null)cancelAnimationFrame(frame);frame=null;last=null;}
  function clearAttacks(){pendingAttacks.clear();attackPageRemaining=0;effects.clear();attackNote.textContent="";for(const member of party){member.attack=0;setMemberHighlight(member,false);member.play?.("Idle");}}
  function syncMotion(){stop();effects.setEnabled(!disabledMotion());if(!visible||document.hidden||disabledMotion())clearAttacks();if(disabledMotion()&&state==="defeated")setBossAction(true);render();schedule();}
  function clearParty(){
    partyGeneration++;
    for(const member of party){
      member.mixer?.stopAllAction();if(member.actor)member.mixer?.uncacheRoot(member.actor);
      // Skeletons are instance-owned; geometry/material/texture are shared with the cache.
      const skeletons=new Set();member.actor?.traverse(n=>{if(n.skeleton)skeletons.add(n.skeleton);});for(const skeleton of skeletons)skeleton.dispose();
      member.identity.material.map.dispose();member.identity.material.dispose();
      member.marker.geometry.dispose();member.marker.material.dispose();
      member.root.clear();
    }
    partyRoot.clear();party.length=0;labels.replaceChildren();
  }
  async function loadActor(member,variant,generation){
    if(!actorTemplates.has(variant)){
      const offline=typeof __RAID_OFFLINE_MODELS__!=="undefined"?__RAID_OFFLINE_MODELS__:null;
      const promise=loader.loadAsync(offline?.[`party-${variant}`]||`./assets/raid-3d/nordic-heroes/${variant}.glb`).then(asset=>{
        if(disposed){clearGroup(asset.scene);return null;}return asset;
      }).catch(()=>{actorTemplates.delete(variant);return null;});
      actorTemplates.set(variant,promise);
    }
    const asset=await actorTemplates.get(variant);
    if(disposed||generation!==partyGeneration)return;
    if(!asset){member.failed=true;member.loading.textContent="角色加载失败";return;}
    const actor=cloneSkeleton(asset.scene);member.actor=actor;
    // Normalize the authored standing pose locally, before attaching it to the ground slot.
    const standing=new T.AnimationMixer(actor);const idle=asset.animations.find(c=>c.name==="Idle");
    if(idle)standing.clipAction(idle).play();standing.update(0);actor.updateMatrixWorld(true);
    const box=new T.Box3().setFromObject(actor,true),size=box.getSize(new T.Vector3());
    const scale=1.72/size.y;actor.scale.setScalar(scale);actor.position.set(0,-box.min.y*scale,0);standing.stopAllAction();standing.uncacheRoot(actor);
    actor.rotation.y=-1.12;
    actor.traverse(n=>{if(n.isMesh){n.frustumCulled=false;n.castShadow=true;n.receiveShadow=true;}});
    member.root.add(actor);member.hand=actor.getObjectByName("palm_r")||actor.getObjectByName("handslotr")||actor.getObjectByName("handr");
    const mixer=new T.AnimationMixer(actor);member.mixer=mixer;let current=null;
    member.play=(name)=>{
      member.returnToRest=false;
      const clip=asset.animations.find(c=>c.name===name)||asset.animations.find(c=>/idle/i.test(c.name));if(!clip)return;
      const attacking=name==="Attack";
      const next=mixer.clipAction(clip);if(current===next&&(next.isRunning()||(!attacking&&next.paused)))return;
      current?.stop();current=next;current.reset();current.setLoop(T.LoopOnce,1);current.clampWhenFinished=true;
      // Idle supplies a fixed standing pose, not a loop (the ranger clip raises its bow).
      current.timeScale=attacking?clip.duration/.7:1;current.paused=!attacking;current.play();mixer.update(0);
    };
    // Do not change actions inside mixer.update: the finishing action can overwrite
    // the restored pose later in that same update. Return to rest after it completes.
    mixer.addEventListener("finished",()=>{member.returnToRest=true;});member.play("Idle");member.loading.hidden=true;member.label.dataset.actorReady="true";render();schedule();
  }
  function attackOrigin(member){
    member.root.updateMatrixWorld(true);
    return member.hand?member.hand.getWorldPosition(new T.Vector3()):member.root.localToWorld(new T.Vector3(0,1.05,0));
  }
  function positionParty(){
    const slots=partyFormation(host.clientWidth,party.length);
    for(let i=0;i<party.length;i++)party[i].root.position.set(slots[i].x,slots[i].y,slots[i].z);
  }
  function resize(){
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;
    const narrow=w<650;camera.fov=narrow?41:36;
    const distance=narrow?Math.max(31,31*390/w):19;
    const nextHome=new T.Vector3(0,distance*(narrow?.65:.42),distance),nextDistance=nextHome.distanceTo(new T.Vector3(0,.8,0));
    if(homeDistance)camera.position.sub(controls.target).multiplyScalar(nextDistance/homeDistance).add(controls.target);
    else camera.position.copy(nextHome);
    homeDistance=nextDistance;controls.minDistance=homeDistance*.55;controls.maxDistance=homeDistance*1.6;
    controls.position0.copy(nextHome);controls.target0.set(0,.8,0);
    positionParty();camera.updateProjectionMatrix();controls.update();render();
  }
  function finishDeath(){if(deathComplete||disposed||state!=="defeated")return;deathComplete=true;host.dataset.animation="Death";host.dispatchEvent(new Event("raid-boss-defeated"));}
  // Some licensed sources have no authored death. Seal them into the ground and
  // fade out; never substitute an idle loop and wait for a nonexistent Death event.
  function setDissolve(progress){
    modelRoot.position.y=.125+(scenes[boss?.assetKey]?.elevation||0)-1.6*progress;
    modelRoot.visible=progress<1;
    for(const {material,opacity,transparent,depthWrite} of bossMaterials){
      const nextTransparent=progress>0||transparent;
      if(material.transparent!==nextTransparent){material.transparent=nextTransparent;material.needsUpdate=true;}
      material.opacity=opacity*(1-progress);material.depthWrite=progress>0?false:depthWrite;
    }
  }
  function play(clipName,once=false,finalPose=false){
    if(!mixer||!gltf)return;
    const clip=gltf.animations.find(c=>c.name===clipName);if(!clip){host.dataset.animation="Static";return;}
    const nextAction=mixer.clipAction(clip);if(action===nextAction&&!finalPose&&nextAction.isRunning())return;
    if(action)action.stop();action=nextAction;action.reset();action.setLoop(once?T.LoopOnce:T.LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;
    action.timeScale=clipName==="Death"?.55:state==="enraged"?1.2:.85;action.play();
    if(finalPose){action.time=clip.duration;action.paused=true;mixer.update(0);if(clipName==="Death")queueMicrotask(finishDeath);}
    else mixer.update(0);
    host.dataset.animation=clip.name;
  }
  function setBossAction(finalPose=false){
    if(!gltf)return;
    returnToBossRest=false;
    modelRoot.scale.setScalar(1);
    if(state==="defeated"){
      hitRemaining=0;modelRoot.rotation.z=0;
      if(gltf.animations.some(c=>c.name==="Death")){
        host.dataset.deathMode="native";play("Death",true,finalPose||disabledMotion());
      }else{
        host.dataset.deathMode="dissolve";host.dataset.animation="Death";
        if(action)action.paused=true;
        deathProgress=finalPose||disabledMotion()?1:deathProgress??0;setDissolve(deathProgress);
        if(deathProgress===1)queueMicrotask(finishDeath);
      }
    }else {
      deathProgress=null;setDissolve(0);delete host.dataset.deathMode;
      play(gltf.animations.some(c=>c.name==="Flying_Idle")?"Flying_Idle":"Idle");if(state==="dormant"&&action)action.paused=true;
    }
  }
  async function loadModel(key){
    const ticket=++revision;message.firstChild?.nodeType===Node.TEXT_NODE&&message.firstChild.remove();message.prepend(document.createTextNode("首领正在进入战场…"));message.hidden=false;retry.hidden=true;
    delete host.dataset.model;delete host.dataset.deathMode;
    if(mixer){mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);}mixer=null;action=null;gltf=null;bossMaterials=[];deathProgress=null;returnToBossRest=false;modelRoot.position.y=.125;modelRoot.visible=true;modelRoot.scale.setScalar(1);clearGroup(modelRoot);
    try {
      const offline=typeof __RAID_OFFLINE_MODELS__!=="undefined"?__RAID_OFFLINE_MODELS__:null;
      const result=await loader.loadAsync(offline?.[key]||`./assets/raid-3d/nordic-models/${key}.glb`);
      if(disposed||ticket!==revision){clearGroup(result.scene);return;}
      gltf=result;const object=result.scene;
      const restMixer=new T.AnimationMixer(object);const restClip=result.animations.find(c=>c.name==="Idle"||c.name==="Flying_Idle");if(restClip)restMixer.clipAction(restClip).play();restMixer.update(0);object.updateMatrixWorld(true);
      const bounds=new T.Box3().setFromObject(object,true),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());restMixer.stopAllAction();restMixer.uncacheRoot(object);
      const scale=Math.min((scenes[key].maxHeight||3.8)/size.y,4.5/size.x,5.8/size.z);object.scale.setScalar(scale);object.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
      object.rotation.y=.65;object.traverse(n=>{if(n.isMesh){n.castShadow=n.receiveShadow=true;n.frustumCulled=false;}});modelRoot.add(object);
      const materials=new Set();object.traverse(n=>{for(const material of n.material?[].concat(n.material):[])materials.add(material);});
      bossMaterials=[...materials].map(material=>({material,opacity:material.opacity,transparent:material.transparent,depthWrite:material.depthWrite}));
      mixer=new T.AnimationMixer(object);mixer.addEventListener("finished",event=>{if(event.action.getClip().name==="Death")finishDeath();else returnToBossRest=true;});
      message.hidden=true;host.dataset.model=key;delete host.dataset.assetError;setBossAction(state==="defeated"&&!boss?.animateDeath);render();schedule();
    }catch(error){if(disposed||ticket!==revision)return;message.firstChild?.nodeType===Node.TEXT_NODE&&message.firstChild.remove();message.prepend(document.createTextNode("Boss 模型加载失败 "));retry.hidden=false;host.dataset.assetError="true";if(state==="defeated")finishDeath();}
  }
  function update(nextBoss,campaignStatus="active",animate=true){
    if(disposed)return;
    const key=Object.hasOwn(scenes,nextBoss.assetKey)?nextBoss.assetKey:"leviathan";
    const changed=boss?.id!==nextBoss.id||boss?.assetKey!==key;
    const nextState=nextBoss.status==="defeated"?"defeated":["ended","aborted"].includes(campaignStatus)||["ended","aborted","locked"].includes(nextBoss.status)?"dormant":nextBoss.status==="settling"||Number(nextBoss.remainingHealth)<=0?"unstable":nextBoss.remainingHealth/nextBoss.health<=.25?"enraged":"idle";
    const stateChanged=state!==nextState;
    boss={...nextBoss,assetKey:key,animateDeath:!changed&&animate};state=nextState;host.dataset.state=state;host.dataset.assetKey=key;
    if(changed){
      deathComplete=false;lastDamage=new Map();clearAttacks();hitRemaining=0;modelRoot.rotation.set(0,0,0);
      if(environment){scene.remove(environment);clearGroup(environment);}const theme=scenes[key];host.dataset.environmentReady="false";
      const nextEnvironment=buildNordicEnvironment(theme);environment=nextEnvironment;scene.add(environment);
      environment.userData.ready.then(()=>{if(!disposed&&environment===nextEnvironment){host.dataset.environmentReady="true";render();}});
      scene.background=new T.Color(theme.sky);scene.fog=new T.FogExp2(theme.sky,.025);rim.color.set(theme.haze);sceneTag.textContent=theme.name;host.style.setProperty("--arena-accent",`#${theme.accent.toString(16).padStart(6,"0")}`);
      effects.setTheme(theme);
      loadModel(key);
    }else if(stateChanged){deathComplete=false;setBossAction(!animate);}
    if(stateChanged&&["defeated","dormant"].includes(state))clearAttacks();
    effects.setActive(state!=="dormant");
    if(!changed&&stateChanged&&state==="defeated"&&animate&&running())effects.victory();
    render();schedule();
  }
  function updateMemberName(entry){
    const name=entry.member.displayName;
    entry.label.setAttribute("aria-label",`${entry.member.own?"我 · ":""}${name}`);entry.label.querySelector("b").textContent=name;
    const texture=entry.identity.material.map,canvas=texture.image,context=canvas.getContext("2d");
    context.font="600 32px system-ui, sans-serif";
    const width=Math.min(320,Math.max(168,Math.ceil(context.measureText(name).width)+16));
    if(canvas.width!==width)texture.dispose(); // Reallocate immutable WebGL texture storage after a label resize.
    canvas.width=width;
    context.font="600 32px system-ui, sans-serif";context.textAlign="center";context.textBaseline="middle";context.lineWidth=5;context.strokeStyle="#10202ddd";context.fillStyle="#ffffff";
    context.strokeText(name,canvas.width/2,24,canvas.width-16);context.fillText(name,canvas.width/2,24,canvas.width-16);texture.needsUpdate=true;
  }
  function makeParty(){
    clearParty();
    const totalPages=Math.max(1,Math.ceil(participants.length/pageSize));page=Math.min(page,totalPages-1);
    const members=participants.slice(page*pageSize,page*pageSize+pageSize);
    for(let i=0;i<members.length;i++){
      const member=members[i];let hash=0;for(const c of member.publicId)hash=(hash*31+c.charCodeAt(0))>>>0;
      const variant=["knight","ranger","mage"][hash%3];
      const label=document.createElement("div");label.className=`raid-member-label${member.own?" is-own":""}`;
      const loading=document.createElement("small");loading.textContent="角色加载中…";
      const id=document.createElement("b");const amount=document.createElement("span");amount.textContent=`${member.own?"我 · ":""}${Number(member.damage||0).toFixed(2)} 伤害`;label.append(id,amount,loading);labels.append(label);
      const root=new T.Group();root.name="raid-participant";partyRoot.add(root);
      const marker=new T.Mesh(new T.RingGeometry(.43,.47,32),new T.MeshBasicMaterial({color:member.own?0xe8c685:0x8caeb4,transparent:true,opacity:.65,side:T.DoubleSide,depthWrite:false}));
      marker.rotation.x=-Math.PI/2;marker.position.y=.025;root.add(marker);
      // Only the anonymous text is a billboard. The character is an ordinary world mesh.
      const textCanvas=document.createElement("canvas");textCanvas.width=168;textCanvas.height=48;
      const texture=new T.CanvasTexture(textCanvas);texture.colorSpace=T.SRGBColorSpace;
      const identity=new T.Sprite(new T.SpriteMaterial({map:texture,color:member.own?0xffdda0:0xd8eced,transparent:true,depthWrite:false,sizeAttenuation:false}));identity.name="raid-masked-id";identity.center.set(.5,0);identity.position.set(0,.045,.78);root.add(identity);
      const entry={member,label,loading,amount,root,marker,identity,attack:0,actor:null,mixer:null,hand:null};updateMemberName(entry);party.push(entry);loadActor(entry,variant,partyGeneration);
    }
    positionParty();
    status.textContent=members.length?`${page+1} / ${totalPages}`:"0 / 0";previous.disabled=page===0;next.disabled=page>=totalPages-1;
    rosterNote.textContent=participantCount>participants.length?`已参战 ${participantCount} 人 · 展示 ${participants.length} 人`:`已参战 ${participantCount} 人`;
    heading.textContent=members.length?"参战小队":"等待参战者加入";
    render();
  }
  function updateParticipants(items=[],count=items.length,scope="",animate=true){
    const reset=campaignId!==scope;campaignId=scope;
    // Accept only the server's anonymous display contract; never render raw IDs/names.
    const clean=items.filter(p=>typeof p.publicId==="string"&&participantName(p)).slice(0,60).map(p=>({publicId:p.publicId,displayName:participantName(p),damage:Number.isFinite(Number(p.damage))?Math.max(0,Number(p.damage)):0,own:Boolean(p.own)}));
    const old=lastDamage;lastDamage=new Map(clean.map(p=>[p.publicId,p.damage]));
    const same=!reset&&participants.map(p=>p.publicId).join("|")===clean.map(p=>p.publicId).join("|");participants=clean;participantCount=Math.max(clean.length,Number(count)||0);
    const canAttack=animate&&!reset&&running()&&!["defeated","dormant"].includes(state);
    if(reset){page=0;clearAttacks();}
    if(!canAttack)clearAttacks();
    for(const publicId of pendingAttacks.keys())if(!lastDamage.has(publicId)||lastDamage.get(publicId)<old.get(publicId))pendingAttacks.delete(publicId);
    if(canAttack)for(const member of clean){
      if(!old.has(member.publicId))continue;
      const delta=Math.round((member.damage-old.get(member.publicId))*1e8)/1e8;
      if(delta>0)pendingAttacks.set(member.publicId,(pendingAttacks.get(member.publicId)||0)+delta);
    }
    if(!same)makeParty();
    for(const member of party){const current=clean.find(p=>p.publicId===member.member.publicId);if(!current)continue;const renamed=member.member.displayName!==current.displayName;member.member=current;if(renamed)updateMemberName(member);member.amount.textContent=`${current.own?"我 · ":""}${current.damage.toFixed(2)} 伤害`;
    }
    playParticipantAttacks();
    rosterNote.textContent=participantCount>participants.length?`已参战 ${participantCount} 人 · 展示 ${participants.length} 人`:`已参战 ${participantCount} 人`;
    render();schedule();
  }
  function playParticipantAttacks(){
    if(!pendingAttacks.size||attackPageRemaining>0||!running()||["defeated","dormant"].includes(state))return;
    for(const member of party)if(member.failed)pendingAttacks.delete(member.member.publicId);
    if(!pendingAttacks.size)return;
    if(!party.some(member=>pendingAttacks.has(member.member.publicId))){
      const index=participants.findIndex(member=>pendingAttacks.has(member.publicId));
      if(index<0){pendingAttacks.clear();return;}
      page=Math.floor(index/pageSize);effects.clear();makeParty();
    }
    const notices=[];
    for(const member of party){
      const delta=pendingAttacks.get(member.member.publicId);if(!delta||!member.actor)continue;
      pendingAttacks.delete(member.member.publicId);member.attack=1;setMemberHighlight(member,true);
      member.play("Attack");const origin=attackOrigin(member);if(origin)effects.launch(origin);
      notices.push(`${member.member.displayName} +${delta.toFixed(2)}`);
    }
    if(notices.length){attackPageRemaining=.9;attackNote.textContent=notices.join(" · ")+" 伤害";}
  }
  function setMemberHighlight(member,attacking){
    member.label.classList.toggle("is-attacking",attacking);
    member.marker.material.color.set(attacking?0xa5ffcf:member.member.own?0xe8c685:0x8caeb4);
    member.marker.material.opacity=attacking?.95:.65;
    member.identity.material.color.set(attacking?0xb6ffda:member.member.own?0xffdda0:0xd8eced);
  }
  function tick(at){
    frame=null;if(!running())return;const delta=last===null?0:(at-last)/1000,dt=Math.min(delta,.06);last=at;elapsed+=dt;
    // Death must complete before the page's 8s transition timeout at low FPS.
    // Pause/visibility already reset `last`, so elapsed time cannot skip a pause.
    if(state!=="dormant")mixer?.update(state==="defeated"?delta:dt);
    if(returnToBossRest)setBossAction();
    if(deathProgress!==null&&deathProgress<1){deathProgress=Math.min(1,deathProgress+delta/1.8);setDissolve(deathProgress);if(deathProgress===1)finishDeath();}
    if(gltf&&!["dormant","defeated"].includes(state)){
      // Secondary whole-body motion for the two sources without authored clips.
      // Party members never enter this path; their idle pose remains fixed.
      const theme=scenes[boss.assetKey];
      if(theme.secondaryMotion==="hover")modelRoot.position.y=.125+theme.elevation+Math.sin(elapsed*1.4)*.08;
      if(theme.secondaryMotion==="breathe")modelRoot.scale.y=1+Math.sin(elapsed*1.8)*.012;
    }
    if(hitRemaining>0)hitRemaining=Math.max(0,hitRemaining-dt);modelRoot.rotation.z=Math.sin(hitRemaining*35)*hitRemaining*.045;
    for(const member of party){
      member.attack=Math.max(0,member.attack-dt*1.4);setMemberHighlight(member,member.attack>0);
      if(state!=="dormant")member.mixer?.update(dt);
      if(member.returnToRest)member.play("Idle");
    }
    attackPageRemaining=Math.max(0,attackPageRemaining-dt);playParticipantAttacks();
    effects.tick(dt,elapsed);
    render();schedule();
  }
  function hit(){if(!boss||["defeated","dormant"].includes(state)||disabledMotion()||!running())return;hitRemaining=.65;effects.impact();if(gltf?.animations.some(c=>c.name==="HitReact"))play("HitReact",true);else host.dataset.animation="HitReact";schedule();}
  const onPrevious=()=>{clearAttacks();page=Math.max(0,page-1);makeParty();},onNext=()=>{clearAttacks();page++;makeParty();};previous.addEventListener("click",onPrevious);next.addEventListener("click",onNext);retry.addEventListener("click",()=>boss&&loadModel(boss.assetKey));
  controls.addEventListener("change",render);
  resetView.addEventListener("click",()=>controls.reset());
  const loss=e=>{e.preventDefault();contextLost=true;stop();message.hidden=false;message.textContent="3D 画面暂时不可用，请刷新页面。";};canvas.addEventListener("webglcontextlost",loss);
  const observer=typeof ResizeObserver==="function"?new ResizeObserver(resize):null;observer?.observe(host);
  const visibility=typeof IntersectionObserver==="function"?new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;syncMotion();}):null;visibility?.observe(host);
  document.addEventListener("visibilitychange",syncMotion);motion?.addEventListener("change",syncMotion);resize();makeParty();
  return {update,hit,updateParticipants,defeatTimeout:()=>8000,setPaused(value){pause=Boolean(value);syncMotion();},setReducedMotion(value){reduced=Boolean(value);syncMotion();},
    destroy(){if(disposed)return;disposed=true;revision++;stop();clearParty();for(const promise of actorTemplates.values())promise.then(asset=>{if(asset)clearGroup(asset.scene);});actorTemplates.clear();controls.removeEventListener("change",render);controls.dispose();observer?.disconnect();visibility?.disconnect();document.removeEventListener("visibilitychange",syncMotion);motion?.removeEventListener("change",syncMotion);mixer?.stopAllAction();if(gltf)mixer?.uncacheRoot(gltf.scene);clearGroup(scene);renderer.dispose();canvas.removeEventListener("webglcontextlost",loss);host.replaceChildren();host.classList.remove("raid-arena");}
  };
}

globalThis.RaidArena=Object.freeze({create,scenes,credits,participantName});
