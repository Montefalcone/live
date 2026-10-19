import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareEdgeBlend, measureEdgeDeltas, updateEdgeDeltas, applyEdgeBlend } from '../js/privacy-edge.js';

const region = { x: 4, y: 4, width: 24, height: 24, edgeBlend: {
  aperture: [[10,8],[22,8],[22,24],[10,24]], innerWidth: 5,
  samples: [{ x: 0, y: 8, width: 3, height: 8, reference: [130,120,100], nightReference: [180,170,155], referenceSigma: 1, nightReferenceSigma: 2 }],
} };
const patch = { x: 0, y: 0, width: 32, height: 32 };
function pixels(rgb = [130,120,100], alpha = 255) {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let i=0;i<data.length;i+=4) data.set([...rgb,alpha],i);
  return data;
}
const offset = (x,y) => (y*32+x)*4;

test('local wall correction excludes apertures, deep interior, dark structures and transparent pixels', () => {
  const day=pixels(),night=pixels([180,170,155]);
  const dark=offset(5,6),transparent=offset(5,7);
  day.set([10,10,10,255],dark); night.set([10,10,10,255],dark);
  day[transparent+3]=0; night[transparent+3]=0;
  const edge=prepareEdgeBlend(region,patch,day,night), mutable=new Set(edge.offsets);
  assert.ok(mutable.has(offset(4,12)), 'wall at outer seam must be adjustable');
  for(let y=8;y<24;y++) for(let x=10;x<22;x++) assert.ok(!mutable.has(offset(x,y)), 'aperture is excluded');
  assert.ok(!mutable.has(dark)); assert.ok(!mutable.has(transparent));
  assert.ok(!mutable.has(offset(9,16)), 'inner edge of the correction fades to zero');
  const before=new Uint8ClampedArray(day),result=applyEdgeBlend(day,edge,[[28,-16,16]]);
  let changed=0;
  for(let p=0;p<result.length;p+=4){
    assert.equal(result[p+3],before[p+3], 'alpha is immutable');
    if(!mutable.has(p)) assert.deepEqual(result.slice(p,p+4),before.slice(p,p+4));
    else if(result[p]!==before[p]) changed++;
  }
  assert.ok(changed>0);
  assert.equal(prepareEdgeBlend({},patch,day,night),null);
});

test('calibrated limits keep the balcony railing and far, unobserved wall unchanged', () => {
 const image=pixels(),r={...region,edgeBlend:{...region.edgeBlend,maxY:16,minY:6}};
 const edge=prepareEdgeBlend(r,patch,image,image);
 for(const p of edge.offsets) assert.ok(Math.floor(p/4/32)<16 && Math.floor(p/4/32)>=6);
 const distant={...region,edgeBlend:{...region.edgeBlend,samples:[{...region.edgeBlend.samples[0],x:300}]}};
 assert.equal(prepareEdgeBlend(distant,patch,image,image).offsets.length,0);
});

test('local measurements account for day/night mix, brightness and fixed saturation', () => {
 const image=pixels([147,137,120]),edge=prepareEdgeBlend(region,patch,image,image);
 const values=measureEdgeDeltas({data:image,width:32,height:32},patch,edge,.5,.95,.97)[0];
 assert.ok(values.every(v=>Math.abs(v)<2), 'an already matching wall should barely change');
 const reference=pixels([130,120,100]);
 const exact=measureEdgeDeltas({data:reference,width:32,height:32},patch,edge,0,1,1)[0];
 assert.deepEqual(exact,[0,0,0]);
});

test('black, clipped, noisy, incompatible and unavailable wall samples are ignored', () => {
 const edge=prepareEdgeBlend(region,patch,pixels(),pixels());
 for(const rgb of [[0,0,0],[255,255,255],[230,230,230]]){
   assert.equal(measureEdgeDeltas({data:pixels(rgb),width:32,height:32},patch,edge,0,1)[0],null);
 }
 const noisy=pixels();
 for(let y=8;y<16;y++) for(let x=0;x<3;x++) noisy.set(y%2?[180,170,150,255]:[80,70,50,255],offset(x,y));
 assert.equal(measureEdgeDeltas({data:noisy,width:32,height:32},patch,edge,0,1)[0],null);
 assert.equal(measureEdgeDeltas({data:pixels(),width:1,height:1},patch,edge,0,1)[0],null);
});

test('a color mismatch is corrected at the seam without replacing texture or alpha', () => {
 const before=pixels(),edge=prepareEdgeBlend(region,patch,before,pixels([180,170,155]));
 const observed=pixels([118,124,116]);
 const target=measureEdgeDeltas({data:observed,width:32,height:32},patch,edge,0,1,1);
 const after=applyEdgeBlend(new Uint8ClampedArray(before),edge,updateEdgeDeltas([],target));
 const p=offset(4,12),truth=observed.slice(p,p+3);
 const error=image=>[0,1,2].reduce((n,c)=>n+Math.abs(image[p+c]-truth[c]),0);
 assert.ok(error(after)<error(before)/4);
 assert.deepEqual(after.slice(offset(14,14),offset(14,14)+4),before.slice(offset(14,14),offset(14,14)+4));
});

test('brief flashes cannot jump the correction; sustained readings change it gradually', () => {
 const state=[];
 assert.deepEqual(updateEdgeDeltas(state,[[0,0,0]]),[[0,0,0]]);
 for(let i=0;i<2;i++) assert.deepEqual(updateEdgeDeltas(state,[[20,20,20]]),[[0,0,0]]);
 assert.deepEqual(updateEdgeDeltas(state,[[0,0,0]]),[[0,0,0]]);
 for(let i=0;i<2;i++) assert.deepEqual(updateEdgeDeltas(state,[[20,20,20]]),[[0,0,0]]);
 assert.deepEqual(updateEdgeDeltas(state,[[20,20,20]]),[[3,3,3]]);
 assert.ok(updateEdgeDeltas(state,[[20,20,20]])[0][0]<6);
});

test('unreadable samples hold briefly, then fade to neutral; fresh state has no stale correction', () => {
 const state=[]; updateEdgeDeltas(state,[[10,10,10]]);
 for(let i=0;i<4;i++) assert.deepEqual(updateEdgeDeltas(state,[null]),[[10,10,10]]);
 assert.deepEqual(updateEdgeDeltas(state,[null]),[[8.5,8.5,8.5]]);
 for(let i=0;i<50;i++) updateEdgeDeltas(state,[null]);
 assert.ok(state[0].value.every(v=>Math.abs(v)<.01));
 assert.deepEqual(updateEdgeDeltas([],[null]),[[0,0,0]]);
});
