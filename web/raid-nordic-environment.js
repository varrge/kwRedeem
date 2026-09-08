import * as T from "three";

// All terrain/stone work is original procedural geometry. The flat courtyard keeps
// the existing authoritative party placement; only its visual surroundings change.
function stoneTexture(seed) {
  let state=seed;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const canvas=document.createElement("canvas");canvas.width=canvas.height=256;
  const ctx=canvas.getContext("2d"),pixels=ctx.createImageData(256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const n=(Math.sin(x*.13+y*.031)+Math.sin(y*.17-x*.07))*8+random()*31;
    const i=(y*256+x)*4;const v=135+n;
    pixels.data[i]=v;pixels.data[i+1]=v+2;pixels.data[i+2]=v+3;pixels.data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  ctx.lineWidth=.6;ctx.strokeStyle="#36434260";
  for(let i=0;i<13;i++){
    let x=random()*256,y=random()*256;ctx.beginPath();ctx.moveTo(x,y);
    for(let k=0;k<7;k++){x+=(random()-.5)*24;y+=random()*15;ctx.lineTo(x,y);}ctx.stroke();
  }
  const texture=new T.CanvasTexture(canvas);texture.wrapS=texture.wrapT=T.RepeatWrapping;
  texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;return texture;
}

export function buildNordicEnvironment(theme) {
  const group=new T.Group();group.name="northern-ruins";
  let state=[...theme.kind].reduce((s,c)=>s+c.charCodeAt(0),514);
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const pending=[];
  function surface(name,repeat=1){
    const texture=stoneTexture(state);texture.repeat.set(repeat,repeat);
    const offline=typeof __RAID_OFFLINE_MODELS__!=="undefined"?__RAID_OFFLINE_MODELS__:null;
    pending.push(new Promise(resolve=>{
      const image=new Image();let alive=true;texture.addEventListener("dispose",()=>{alive=false;image.onload=image.onerror=null;resolve();});
      image.onload=()=>{if(alive){const canvas=texture.image;canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);texture.needsUpdate=true;}resolve();};image.onerror=()=>resolve();
      image.src=offline?.[`texture-${name}`]||`./assets/raid-3d/nordic-textures/${name}.jpg`;
    }));return texture;
  }
  const map=surface("stone"),floorMap=surface("paving",5),earthMap=surface("stone",18);
  const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.96,map,bumpMap:map,bumpScale:.035,...extra});
  const stone=mat(0xb8bab1), darkStone=mat(0x8f9592), earth=mat(theme.ground,{map:earthMap,bumpMap:earthMap,bumpScale:.13}),snow=mat(0xc1ccca), iron=mat(0x373b3b,{metalness:.65,roughness:.62});
  const mats=[stone,darkStone,mat(0xa1a79e),mat(0xa9aba1)];
  // Crossed alpha-cutout bough cards keep distant pine silhouettes organic without
  // large tree meshes; trunks/foliage remain fixed world geometry, not camera billboards.
  const needles=document.createElement("canvas");needles.width=256;needles.height=512;const nctx=needles.getContext("2d");
  nctx.strokeStyle="#343e36";nctx.lineWidth=5;nctx.beginPath();nctx.moveTo(128,510);nctx.lineTo(128,18);nctx.stroke();
  for(let layer=0;layer<31;layer++){
    const y=27+layer*13,length=9+layer*3.3;
    for(const sign of [-1,1]){
      const endX=128+sign*length,endY=y+13+random()*20;nctx.strokeStyle="#273f34";nctx.lineWidth=2;nctx.beginPath();nctx.moveTo(128,y);nctx.lineTo(endX,endY);nctx.stroke();
      for(let step=0;step<25;step++){
        const t=step/25,x=128+sign*length*t,by=y+(endY-y)*t;
        for(let strand=0;strand<5;strand++){
          const size=7+(1-t)*13,shade=25+Math.floor(random()*20);
          nctx.strokeStyle=`rgb(${shade},${shade+14},${shade+8})`;nctx.lineWidth=1+random();nctx.beginPath();nctx.moveTo(x,by);nctx.lineTo(x+sign*(random()-.3)*size,by-size*(.3+random()));nctx.stroke();
        }
      }
    }
  }
  const needlesMap=new T.CanvasTexture(needles);needlesMap.colorSpace=T.SRGBColorSpace;
  const foliageMaterial=new T.MeshStandardMaterial({map:needlesMap,alphaTest:.4,side:T.DoubleSide,roughness:1,color:theme.kind==="ice"?0xc0d1cd:0xb4c5b7});
  const foliagePlane=new T.PlaneGeometry(1,1);
  const mesh=(geometry,material,x,y,z)=>{const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;group.add(m);return m;};
  const box=(x,y,z,w,h,d,material=stone)=>mesh(new T.BoxGeometry(w,h,d),material,x,y,z);
  const cone=(x,y,z,r,h,material,n=8)=>mesh(new T.ConeGeometry(r,h,n),material,x,y,z);
  const terrainGeometry=new T.PlaneGeometry(100,100,58,58);terrainGeometry.rotateX(-Math.PI/2);
  const positions=terrainGeometry.attributes.position;
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),z=positions.getZ(i),edge=Math.max(0,Math.max(Math.abs(x)/9,Math.abs(z)/6)-1);
    const height=-.035+Math.min(1,edge)*(.25*Math.sin(x*.5)*Math.cos(z*.7)+Math.sin(x*.11+z*.16)*.9);
    positions.setY(i,height);
  }
  terrainGeometry.computeVertexNormals();const terrain=mesh(terrainGeometry,earth,0,0,0);terrain.name="continuous-landscape";terrain.castShadow=false;
  // Level old flagstones under feet (top y=.125), extending into broken outer paving.
  const paving=mesh(new T.PlaneGeometry(18,12),mat(0xafb2a8,{map:floorMap,bumpMap:floorMap,bumpScale:.085}),0,.125,0);paving.rotation.x=-Math.PI/2;paving.castShadow=false;paving.name="weathered-courtyard";
  function rock(x,z,size,material=darkStone,y=0){const r=mesh(new T.DodecahedronGeometry(size,0),material,x,y+size*.35,z);r.scale.set(1,.6+random()*.6,.7+random()*.6);r.rotation.set(random(),random()*6,random()*.5);return r;}
  for(let i=0;i<70;i++){
    const x=(random()-.5)*29,z=(random()-.5)*21;
    if(Math.abs(x)<7.4&&Math.abs(z)<4)continue;
    rock(x,z,.1+random()*.65,mats[i%4]);
  }
  function wall(x,z,length,height,rotation=0){
    const root=new T.Group();root.position.set(x,0,z);root.rotation.y=rotation;group.add(root);
    for(let row=0;row<height;row++)for(let col=0;col<length;col++){
      if(row===height-1&&random()<.25)continue;
      const stoneBlock=new T.Mesh(new T.BoxGeometry(.94,.46,.72),mats[(row+col)%4]);stoneBlock.position.set((col-length/2)*1.01+(row%2)*.16,row*.49+.24,0);stoneBlock.rotation.z=(random()-.5)*.014;stoneBlock.castShadow=stoneBlock.receiveShadow=true;root.add(stoneBlock);
    }
    return root;
  }
  function arch(x,z,width=3.5){
    for(const sign of [-1,1])for(let row=0;row<6;row++)box(x+sign*width/2,row*.49+.24,z,.8,.46,.85,mats[row%4]);
    for(let i=0;i<11;i++){
      const angle=(i+.5)/11*Math.PI;
      const block=box(x+Math.cos(angle)*width/2,2.95+Math.sin(angle)*width/2,z,.56,.65,.9,mats[i%4]);block.rotation.z=angle-Math.PI/2;
    }
    // Worn lintel relief.
    const crest=box(x,4.15,z+.5,.6,.85,.12,darkStone);crest.rotation.z=Math.PI/4;
  }
  function pine(x,z,h){
    const bark=darkStone;
    mesh(new T.CylinderGeometry(.07,.19,h*.78,7),bark,x,h*.39,z);
    for(let face=0;face<3;face++){
      const foliage=mesh(foliagePlane,foliageMaterial,x,h*.49,z);foliage.scale.set(h*.62,h,1);foliage.rotation.y=face*Math.PI/3+x*.12;
    }
  }
  function brazier(x,z){
    box(x,.18,z,.65,.35,.65,darkStone);mesh(new T.CylinderGeometry(.095,.16,1.2,8),iron,x,.93,z);
    mesh(new T.CylinderGeometry(.4,.2,.24,10,1,true),iron,x,1.56,z);
    const flame=cone(x,1.87,z,.15,.58,new T.MeshBasicMaterial({color:0xffb761}),9);flame.name="brazier-flame";
    cone(x,1.72,z,.11,.3,new T.MeshBasicMaterial({color:0xffe8a9}),8);
    const light=new T.PointLight(0xffb46d,20,8,2);light.position.set(x,2,z);group.add(light);
  }
  function grave(x,z){const m=box(x,.48,z,.45,.9,.14,darkStone);m.rotation.z=(random()-.5)*.2;box(x,.79,z,.71,.15,.17,stone);}
  function obelisk(x,z,height){const m=cone(x,height*.5,z,.38,height,darkStone,5);m.scale.z=.62;return m;}
  // Backdrop is real geometry around the arena; no billboard and no square toy plinth.
  for(let i=0;i<13;i++){
    const angle=i/13*Math.PI*2,x=Math.cos(angle)*(24+random()*10),z=Math.sin(angle)*(24+random()*10);
    const mountain=cone(x,3+random()*2,z,7+random()*4,8+random()*12,mat(theme.kind==="ice"?0x76898d:0x5a6a6c),7);mountain.rotation.y=random()*6;mountain.scale.z=.7;
  }
  for(const [x,z,h] of [[-11,-9,7],[-8.7,-12,9],[-1.2,-12,7.2],[9,-12,9],[12,-7,6],[-13,4,6],[14,3,7]])pine(x,z,h);
  arch(-3.1,-6.25,4.1);
  wall(-8,-6.2,5,6);wall(2.5,-6.2,5,4);wall(-9,-2.4,5,3,Math.PI/2);
  brazier(-5.7,-3.8);brazier(-.55,-4.1);
  if(["lava","ice","forest"].includes(theme.kind)){
    for(let i=0;i<18;i++){const x=(random()-.5)*23,z=(random()-.5)*16;if(Math.abs(x)<6&&Math.abs(z)<4)continue;rock(x,z,.35+random()*.45,snow);}
  }
  switch(theme.kind){
    case "lava":
      for(let i=0;i<10;i++)rock(-7-random()*3,2+random()*5,.25+random()*.9,darkStone);
      box(-8.5,.03,3.8,.24,.04,4,new T.MeshStandardMaterial({color:0xab5b32,emissive:0xb64b19,emissiveIntensity:.5,roughness:1}));break;
    case "forest":
      pine(-6,-8,6.7);pine(5.8,-9,8);pine(9,4,5.8);wall(7.5,-6,3,2);break;
    case "hive":
      for(let i=0;i<5;i++){const x=-6+i*2.4;obelisk(x,-4.9,.8+random());rock(x-.4,-5.2,.5,mat(0x877a56));}break;
    case "lab":
      for(const x of [-6.8,-3.1,.7]){obelisk(x,-4.6,2.5);box(x,1.25,-4.32,.035,.85,.015,new T.MeshBasicMaterial({color:0x7aada9}));}break;
    case "fortress":
      wall(7,-4.8,4,7);wall(9,-1.1,5,5,Math.PI/2);for(const x of [-6,7]){const cloth=box(x,2.3,-5.5,.8,1.5,.035,mat(0x573e39));cloth.rotation.z=-.04;}break;
    case "swamp":
      for(let i=0;i<8;i++)grave(6.7+(i%3)*1.2,-5.2-Math.floor(i/3)*1.6);
      const water=mesh(new T.CircleGeometry(3.4,32),new T.MeshStandardMaterial({color:0x283b34,roughness:.17,metalness:.2}),-9,-.06,3);water.rotation.x=-Math.PI/2;break;
    case "ice":
      for(const x of [-7.8,-.3,8]){const ice=obelisk(x,-5.1,2.2+random());ice.material=mat(0xadc5c8,{metalness:.1,roughness:.37});}break;
    case "astral":
      const ring=mesh(new T.TorusGeometry(1.5,.065,8,48),new T.MeshStandardMaterial({color:0x7b8593,emissive:0x6b7c9b,emissiveIntensity:.5}),-3.1,2.75,-6.1);ring.rotation.y=.08;
      for(const x of [-6.7,.4])obelisk(x,-4.7,2.2);break;
  }
  group.userData.ready=Promise.all(pending);
  return group;
}
