import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareRoofGlare,reduceMagenta,applyRoofGlare} from '../js/privacy-glare.js';
import {PRIVACY_CALIBRATION} from '../js/privacy-calibration.js';
const region={roofGlare:{polygon:[[1,1],[4,1],[4,4],[1,4]],feather:.1}};
const patch={x:0,y:0,width:5,height:5};
const glare=prepareRoofGlare(region,patch);
const make=rgba=>Uint8ClampedArray.from(Array(25).fill(rgba).flat());

test('red/magenta flare becomes warm roof color without losing green-channel detail',()=>{
 const c=reduceMagenta(160,60,100);
 assert.ok(c[0]<100&&c[2]<60);assert.equal(c[1],60);
 assert.ok(c[0]>c[1]&&c[1]>c[2],'keep a warm hue, not gray');
 for(const g of [20,40,80,120])assert.equal(reduceMagenta(g*2,g,g*1.3)[1],g);
});
test('neutral, blue, normal brown and very dark or clipped pixels stay unchanged',()=>{
 for(const rgb of [[80,60,40],[100,100,100],[60,80,110],[8,3,4],[255,240,250]])assert.deepEqual(reduceMagenta(...rgb),rgb);
 assert.deepEqual(reduceMagenta(160,60,100,0),[160,60,100]);
 const half=reduceMagenta(160,60,100,.5),full=reduceMagenta(160,60,100,1);
 assert.ok(half[0]>full[0]&&half[0]<160);
});
test('polygon correction cannot touch neighboring pixels or lower any opacity',()=>{
 const d=make([160,60,100,255]),original=new Uint8ClampedArray(d);
 assert.equal(applyRoofGlare(d,glare),9);
 const allowed=new Set(glare.offsets);
 for(let p=0;p<d.length;p+=4){
  assert.equal(d[p+3],255);
  if(!allowed.has(p))assert.deepEqual(d.subarray(p,p+4),original.subarray(p,p+4));
 }
});
test('transparent live area is corrected only with a valid public frame',()=>{
 const d=make([0,0,0,0]);
 assert.equal(applyRoofGlare(d,glare),0);
 assert.equal(applyRoofGlare(d,glare,{width:1,height:1,data:new Uint8ClampedArray(4)}),0);
 const live={width:3,height:3,data:Uint8ClampedArray.from(Array(9).fill([160,60,100,255]).flat())};
 assert.equal(applyRoofGlare(d,glare,live),9);
 for(const p of glare.offsets){assert.equal(d[p+3],255);assert.equal(d[p+1],60);assert.ok(d[p]<100);}
});
test('an opaque photo stays independent of live pixels behind the camera mask',()=>{
 const a=make([160,60,100,255]),b=new Uint8ClampedArray(a);
 applyRoofGlare(a,glare,{width:3,height:3,data:new Uint8ClampedArray(36)});
 applyRoofGlare(b,glare,{width:3,height:3,data:new Uint8ClampedArray(36).fill(255)});
 assert.deepEqual(a,b);
});
test('failed local reads retain transparent edges and still correct opaque photo pixels',()=>{
 const d=make([160,60,100,128]);d[glare.offsets[0]+3]=255;
 assert.equal(applyRoofGlare(d,glare,null),1);
 for(const p of glare.offsets.slice(1))assert.deepEqual([...d.subarray(p,p+4)],[160,60,100,128]);
});
test('production roof correction excludes all windows, doors and main gutter',()=>{
 const g=prepareRoofGlare(PRIVACY_CALIBRATION.regions[0],{x:0,y:634,width:884,height:518});
 const included=new Set(g.offsets);
 for(const [x,y] of [[680,750],[570,780],[450,900],[780,880],[800,900],[520,730],[600,699]])
  assert.equal(included.has(((y-634)*884+x)*4),false,`${x},${y}`);
 assert.equal(included.has(((790-634)*884+740)*4),true);
 assert.equal(included.has(((831-634)*884+748)*4),true);
});
