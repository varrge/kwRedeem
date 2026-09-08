import * as T from "three";

// A fixed number of effects keeps rapid syncs/clicks from accumulating GPU objects.
export function createEffects(scene) {
  const group=new T.Group();scene.add(group);
  const sprite=document.createElement("canvas");sprite.width=sprite.height=32;
  const ctx=sprite.getContext("2d");const gradient=ctx.createRadialGradient(16,16,0,16,16,16);
  gradient.addColorStop(0,"#fff");gradient.addColorStop(.25,"#ffffffcc");gradient.addColorStop(1,"#ffffff00");ctx.fillStyle=gradient;ctx.fillRect(0,0,32,32);
  const texture=new T.CanvasTexture(sprite);
  const ambientPositions=new Float32Array(72*3),sparkPositions=new Float32Array(96*3),velocity=new Float32Array(96*3),life=new Float32Array(96);
  for(let i=0;i<96;i++)sparkPositions[i*3+1]=-20;
  const ambientGeometry=new T.BufferGeometry();ambientGeometry.setAttribute("position",new T.BufferAttribute(ambientPositions,3));
  const ambientMaterial=new T.PointsMaterial({map:texture,color:0xc8d4d5,size:.09,transparent:true,opacity:.3,depthWrite:false,blending:T.AdditiveBlending});
  const ambient=new T.Points(ambientGeometry,ambientMaterial);ambient.frustumCulled=false;group.add(ambient);
  const sparkGeometry=new T.BufferGeometry();sparkGeometry.setAttribute("position",new T.BufferAttribute(sparkPositions,3));
  const sparkMaterial=new T.PointsMaterial({map:texture,color:0xffe6b0,size:.19,transparent:true,opacity:.95,depthWrite:false,blending:T.AdditiveBlending});
  const sparks=new T.Points(sparkGeometry,sparkMaterial);sparks.frustumCulled=false;sparks.visible=false;group.add(sparks);
  const ringGeometry=new T.RingGeometry(.93,1,56);
  const rings=Array.from({length:3},()=>{
    const mesh=new T.Mesh(ringGeometry,new T.MeshBasicMaterial({color:0xffcb83,transparent:true,opacity:0,side:T.DoubleSide,depthWrite:false,blending:T.AdditiveBlending}));
    mesh.rotation.x=-Math.PI/2;mesh.position.set(-3.1,.35,0);mesh.visible=false;group.add(mesh);return {mesh,age:1,duration:1};
  });
  const orbGeometry=new T.SphereGeometry(.085,8,6);
  const orbMaterial=new T.MeshBasicMaterial({color:0xe7dab7});
  const bolts=Array.from({length:6},()=>{
    const orb=new T.Mesh(orbGeometry,orbMaterial);group.add(orb);orb.visible=false;
    const positions=new Float32Array(8*3),geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.BufferAttribute(positions,3));
    const trail=new T.Line(geometry,new T.LineBasicMaterial({color:0xcdb892,transparent:true,opacity:.65,depthWrite:false,blending:T.AdditiveBlending}));trail.frustumCulled=false;trail.visible=false;group.add(trail);
    return {orb,trail,positions,from:new T.Vector3(),age:1,duration:.6};
  });
  const light=new T.PointLight(0xffb862,0,7,2);light.position.set(-3.1,2,0);group.add(light);
  let kind="lava",cursor=0,boltIndex=0,ringIndex=0,active=true,enabled=true,lightLife=0;
  const target=new T.Vector3(-3.1,1.75,0),point=new T.Vector3();
  function path(from,t,out){out.lerpVectors(from,target,t);out.y+=Math.sin(Math.PI*t)*.8;return out;}
  function burst(count,victory=false){
    for(let i=0;i<count;i++){
      const n=cursor++%life.length,k=n*3;life[n]=victory?1.8:.8;
      sparkPositions[k]=target.x;sparkPositions[k+1]=target.y;sparkPositions[k+2]=target.z;
      velocity[k]=(Math.random()-.5)*(victory?6:4);velocity[k+1]=1+Math.random()*(victory?5:3);velocity[k+2]=(Math.random()-.5)*4;
    }
    sparks.visible=true;
  }
  function ripple(victory=false){const ring=rings[ringIndex++%rings.length];ring.age=0;ring.duration=victory?1.6:.9;ring.mesh.visible=true;ring.mesh.scale.setScalar(.3);ring.mesh.material.opacity=.8;}
  function clear(){
    life.fill(0);sparks.visible=false;light.intensity=0;lightLife=0;
    for(let i=0;i<96;i++)sparkPositions[i*3+1]=-20;sparkGeometry.attributes.position.needsUpdate=true;
    for(const ring of rings){ring.age=ring.duration;ring.mesh.visible=false;}
    for(const bolt of bolts){bolt.age=bolt.duration;bolt.orb.visible=bolt.trail.visible=false;}
  }
  return {
    group,
    setTheme(theme){
      clear();kind=theme.kind;ambientMaterial.color.set(theme.accent);sparkMaterial.color.set(theme.accent);light.color.set(theme.accent);
      for(const ring of rings)ring.mesh.material.color.set(theme.accent);
      for(let i=0;i<72;i++){ambientPositions[i*3]=(Math.random()-.5)*13;ambientPositions[i*3+1]=.35+Math.random()*4.5;ambientPositions[i*3+2]=(Math.random()-.5)*6.5;}
      ambientGeometry.attributes.position.needsUpdate=true;
    },
    setActive(value){active=Boolean(value);if(!active)clear();},
    setEnabled(value){enabled=Boolean(value);group.visible=enabled;if(!enabled)clear();},
    launch(from){
      if(!active||!enabled)return;
      const bolt=bolts[boltIndex++%bolts.length];bolt.from.copy(from);bolt.age=0;bolt.orb.position.copy(bolt.from);bolt.orb.visible=bolt.trail.visible=true;
      for(let i=0;i<8;i++)bolt.from.toArray(bolt.positions,i*3);
      bolt.trail.geometry.attributes.position.needsUpdate=true;
    },
    impact(){if(active&&enabled){burst(22);ripple();lightLife=.55;}},
    victory(){if(active&&enabled){clear();burst(84,true);ripple(true);lightLife=.9;}},
    clear,
    tick(dt,time){
      if(!enabled)return;
      for(let i=0;i<72;i++){
        const k=i*3;ambientPositions[k+1]+=dt*(kind==="ice"?-.42:.18+(i%3)*.05);ambientPositions[k]+=Math.sin(time*.6+i)*dt*.08;
        if(ambientPositions[k+1]>5)ambientPositions[k+1]=.3;if(ambientPositions[k+1]<.25)ambientPositions[k+1]=4.9;
      }
      ambientGeometry.attributes.position.needsUpdate=true;
      for(const bolt of bolts){
        if(bolt.age>=bolt.duration)continue;bolt.age+=dt;const t=Math.min(1,bolt.age/bolt.duration);path(bolt.from,t,bolt.orb.position);
        for(let i=0;i<8;i++){path(bolt.from,Math.max(0,t-i*.025),point);point.toArray(bolt.positions,i*3);}bolt.trail.geometry.attributes.position.needsUpdate=true;
        if(t===1){bolt.orb.visible=bolt.trail.visible=false;burst(10);}
      }
      let alive=0;
      for(let i=0;i<96;i++){
        const k=i*3;if(life[i]>0){life[i]-=dt;velocity[k+1]-=dt*4;sparkPositions[k]+=velocity[k]*dt;sparkPositions[k+1]+=velocity[k+1]*dt;sparkPositions[k+2]+=velocity[k+2]*dt;alive++;}
        else sparkPositions[k+1]=-20;
      }
      sparks.visible=alive>0;sparkGeometry.attributes.position.needsUpdate=true;
      for(const ring of rings){if(ring.age>=ring.duration)continue;ring.age+=dt;const t=Math.min(1,ring.age/ring.duration);ring.mesh.scale.setScalar(.3+t*(ring.duration>1?4.8:3));ring.mesh.material.opacity=(1-t)*.75;if(t===1)ring.mesh.visible=false;}
      lightLife=Math.max(0,lightLife-dt);light.intensity=lightLife*5;
    }
  };
}
