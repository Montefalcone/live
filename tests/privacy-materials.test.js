import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateSampleGain, prepareMaterials, advanceMaterialGain, applyMaterialGains,
  prepareRoofTexture, applyRoofTexture } from '../js/privacy-materials.js';
import { analyzeFrame, mixPatches } from '../js/privacy.js';
import { PRIVACY_CALIBRATION } from '../js/privacy-calibration.js';

const samples = Array.from({length:5}, (_,x) => ({ x,y:0,width:1,height:1,
  reference:[100,100,100],nightReference:[50,50,50] }));
const config = {width:5,height:1};
const frame = values => ({width:values.length,height:1,
  data:Uint8ClampedArray.from(values.flatMap(v=>[v,v,v,255]))});

test('facade exposure rejects a moving shadow and clamps a consistent bright scene', () => {
  assert.equal(estimateSampleGain(frame([120,120,120,120,50]),samples,config,0),1.18);
  assert.equal(estimateSampleGain(frame([120,120,120,120,50]),samples,config,0,{gainRange:[.5,2]}),1.2);
  assert.equal(estimateSampleGain(frame([100,100,100,100,100]),samples,config,1,{gainRange:[.5,2]}),2);
});
test('black, clipped and conflicting exposure readings cannot drive adaptation', () => {
  assert.equal(estimateSampleGain(frame([0,0,0,255,255]),samples,config,0),null);
  assert.equal(estimateSampleGain(frame([20,40,80,160,240]),samples,config,0),null);
  assert.equal(estimateSampleGain(frame([0,0,0,0,100]),samples,config,0),null);
});
test('exposure changes require persistence; missing samples return gradually to neutral', () => {
  const state={}; assert.equal(advanceMaterialGain(state,1),1);
  assert.equal(advanceMaterialGain(state,2),1);
  assert.equal(advanceMaterialGain(state,2),1);
  assert.equal(advanceMaterialGain(state,2),1.15);
  for(let i=0;i<4;i++)assert.equal(advanceMaterialGain(state,null),1.15);
  assert.ok(advanceMaterialGain(state,null)<1.15);
  const restarted={};assert.equal(advanceMaterialGain(restarted,null),1);
  assert.equal(advanceMaterialGain({},.85),.85);
});
test('a brief flash cannot change exposure and interrupted candidates must restart', () => {
  const state={};advanceMaterialGain(state,1);
  advanceMaterialGain(state,2);advanceMaterialGain(state,null);
  assert.equal(advanceMaterialGain(state,2),1);
  assert.equal(advanceMaterialGain(state,2),1);
  assert.equal(advanceMaterialGain(state,1),1);
});

test('roof correction leaves facade pixels and alpha unchanged and preserves RGB ratios', () => {
  const source=Uint8ClampedArray.from([120,80,40,255, 240,160,80,128, 60,40,20,255]);
  const region={materials:[{lines:[{x0:0,y0:.5,x1:3,y1:.5}],transition:1}]};
  const material=prepareMaterials(region,{x:0,y:0,width:1,height:3},source);
  assert.deepEqual([...material[0].offsets],[0]);
  const dest=mixPatches(source,source,0,1);
  applyMaterialGains(dest,source,source,0,1,material,[3]);
  assert.deepEqual([...dest.subarray(0,4)],[255,170,85,255]);
  assert.deepEqual([...dest.subarray(4)],[...source.subarray(4)]);
  const first=new Uint8ClampedArray(dest);
  applyMaterialGains(dest,source,source,0,1,material,[3]);
  assert.deepEqual(dest,first,'immutable references prevent cumulative drift');
});

const roofRegion={roofTexture:{x:1,y:0,width:2,height:2,dx:-1,dy:0,
  line:{x0:0,y0:1,x1:3,y1:1},inset:0,transition:1}};
test('live roof borrowing affects only selected opaque roof pixels, not the gutter or facade', () => {
  const base=Uint8ClampedArray.from(Array(6).fill([80,60,40,255]).flat());
  base[3]=0;
  const texture=prepareRoofTexture(roofRegion,{x:0,y:0,width:3,height:2},base);
  assert.deepEqual([...texture.offsets],[4,8]);
  assert.deepEqual(texture.source,{x:0,y:0,width:2,height:2});
  const original=new Uint8ClampedArray(base);
  assert.ok(applyRoofTexture(base,texture,{width:2,height:2,data:Uint8ClampedArray.from(Array(4).fill([100,70,20,255]).flat())},0));
  assert.deepEqual([...base.subarray(4,12)],[100,70,20,255,100,70,20,255]);
  assert.deepEqual(base.subarray(12),original.subarray(12));
  for(let i=3;i<base.length;i+=4)assert.equal(base[i],original[i]);
});
test('bad live roof input retains photographic fallback; a dark roof is valid at night', () => {
  const base=new Uint8ClampedArray(24).fill(100);
  const texture=prepareRoofTexture(roofRegion,{x:0,y:0,width:3,height:2},base);
  const original=new Uint8ClampedArray(base);
  assert.equal(applyRoofTexture(base,texture,frame([200]),0),false);
  const dark={width:2,height:2,data:new Uint8ClampedArray(16)};
  assert.equal(applyRoofTexture(base,texture,dark,0),false);
  assert.deepEqual(base,original);
  assert.equal(applyRoofTexture(base,texture,dark,1),true);
  assert.equal(base[4],0);assert.equal(base[7],100);
});
test('every configured black check is required before showing the whole facade', () => {
  const checks=Array.from({length:5},(_,x)=>({x,y:0,width:1,height:1}));
  const cfg={...config,requireAllMasks:true,regions:[{maskChecks:checks}]};
  assert.ok(analyzeFrame(frame([0,0,0,0,0]),cfg)[0]);
  for(let missing=0;missing<5;missing++){
    const pixels=Array(5).fill(0);pixels[missing]=100;
    assert.equal(analyzeFrame(frame(pixels),cfg)[0],null);
  }
  assert.equal(analyzeFrame(frame([0,0,0,0,0]),{...cfg,regions:[{maskChecks:[]} ]})[0],null);
});
test('a failed region invalidates other regions when all masks are required', () => {
  const cfg={...config,requireAllMasks:true,regions:[
    {maskChecks:[{x:0,y:0,width:1,height:1}]},
    {maskChecks:[{x:1,y:0,width:1,height:1}]},
  ]};
  assert.deepEqual(analyzeFrame(frame([0,100,0,0,0]),cfg),[null,null]);
});
test('production live roof source is inside the public roof and outside every camera mask check', () => {
  const cfg=PRIVACY_CALIBRATION,r=cfg.regions[0],s=r.roofTexture;
  const source={x:s.x+s.dx,y:s.y+s.dy,width:s.width,height:s.height};
  assert.equal(cfg.requireAllMasks,true);assert.equal(r.maskChecks.length,5);
  assert.ok(source.x>=0&&source.y>=0&&source.x+source.width<=cfg.width&&source.y+source.height<=cfg.height);
  for(const c of r.maskChecks) assert.ok(source.x+source.width<=c.x||source.x>=c.x+c.width||source.y+source.height<=c.y||source.y>=c.y+c.height);
  for(const x of [source.x,source.x+source.width]){
    const line=s.lines.find(l=>x>=l.x0&&x<=l.x1);
    const e=line.y0+(line.y1-line.y0)*(x-line.x0)/(line.x1-line.x0);
    assert.ok(source.y+source.height<e-8,'source must remain above the gutter');
  }
});

test('production gutter rim stays photographic across every segment and receives no roof gain', () => {
  const r=PRIVACY_CALIBRATION.regions[0],patch={x:0,y:634,width:884,height:518};
  const source=new Uint8ClampedArray(patch.width*patch.height*4).fill(150);
  const texture=prepareRoofTexture(r,patch,source),roof=prepareMaterials(r,patch,source);
  const textureOffsets=new Set(texture.offsets),roofOffsets=new Set(roof.flatMap(m=>[...m.offsets]));
  const output=new Uint8ClampedArray(source);
  applyMaterialGains(output,source,source,0,1,roof,[2.2]);
  const live={width:texture.source.width,height:texture.source.height,
    data:new Uint8ClampedArray(texture.source.width*texture.source.height*4).fill(220)};
  applyRoofTexture(output,texture,live,0);
  for(const line of r.roofTexture.lines) for(let x=line.x0;x<=line.x1;x++){
    const edge=line.y0+(line.y1-line.y0)*(x-line.x0)/(line.x1-line.x0);
    for(let y=Math.floor(edge)-1;y<=Math.ceil(edge)+8;y++){
      const p=((y-patch.y)*patch.width+x)*4;
      assert.equal(textureOffsets.has(p),false,`live tile overwrite at ${x},${y}`);
      assert.equal(roofOffsets.has(p),false,`roof exposure on gutter at ${x},${y}`);
      assert.deepEqual(output.subarray(p,p+4),source.subarray(p,p+4));
    }
  }
  // The small roof junction must not inherit exposure from the main roof.
  for(let y=800;y<840;y++)for(let x=722;x<760;x++){
    const p=((y-patch.y)*patch.width+x)*4;
    assert.deepEqual(output.subarray(p,p+4),source.subarray(p,p+4));
  }
});

test('roof texture uses the local gutter segment and skips gaps instead of extrapolating', () => {
  const source=new Uint8ClampedArray(8*4*4).fill(150),patch={x:0,y:0,width:8,height:4};
  const r={roofTexture:{x:0,y:0,width:8,height:4,dx:0,dy:0,inset:0,transition:1,
    lines:[{x0:0,y0:1,x1:2,y1:1},{x0:4,y0:3,x1:6,y1:2}]}};
  const t=prepareRoofTexture(r,patch,source),selected=new Set(t.offsets);
  assert.equal(selected.has((1*8+4)*4),true);
  assert.equal(selected.has((1*8+1)*4),false);
  for(let y=0;y<4;y++)for(const x of [3,7])assert.equal(selected.has((y*8+x)*4),false);
});
