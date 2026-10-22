import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PRIVACY_WEATHER as catalog} from '../js/privacy-weather-catalog.js';
import {rankWeather,createWeatherSelector,blendWeatherPixels,weatherSamples,describeWeather} from '../js/privacy-weather.js';
const [sun,fog]=catalog.profiles;
const rank=s=>rankWeather(s,catalog.profiles,catalog.samples,catalog.settings);
test('real calibrated fog and sun select their own photographic reference despite exposure changes',()=>{
  for(const p of catalog.profiles) for(const gain of [.75,.9,1,1.2]) {
    const signature=p.signature.map(s=>({...s,rgb:s.rgb.map(v=>Math.min(255,v*gain)),contrast:s.contrast*gain}));
    assert.equal(rank(signature).best,p.id,`${p.id} exposure ${gain}`);
  }
});
test('one changed facade sample cannot outweigh the rest of the static scene',()=>{
  const signature=structuredClone(fog.signature);
  signature[catalog.samples.findIndex(s=>s.group==='walls')]={rgb:[80,20,30],contrast:80,black:0,clipped:0};
  assert.equal(rank(signature).best,fog.id);
});
test('dark, clipped, missing and ambiguous evidence never claims a weather match',()=>{
  for(const input of [fog.signature.map(()=>null),fog.signature.map(s=>({...s,black:1})),fog.signature.map(s=>({...s,clipped:1}))]) assert.equal(rank(input).matched,false);
  const clones=[sun,{...sun,id:'duplicate'}];
  assert.equal(rankWeather(sun.signature,clones,catalog.samples).matched,false);
});
test('startup selects fog immediately; brief clouds, night and insufficient evidence cannot switch it',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples);
  s.observe(fog.signature,0);assert.deepEqual(s.weights(0),{[fog.id]:1});
  for(let t=5000;t<30000;t+=5000) s.observe(sun.signature,t);
  assert.equal(s.diagnostics().profile,fog.id);
  s.observe(sun.signature,30000,1);assert.equal(s.diagnostics().candidate,null);
  s.observe(fog.signature.map(()=>null),35000);assert.equal(s.diagnostics().profile,fog.id);
});
test('sustained better evidence changes after dwell, and RGB weights crossfade for eight seconds',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples);
  s.observe(sun.signature,0);
  for(let t=5000;t<=120000;t+=5000) s.observe(fog.signature,t);
  assert.equal(s.diagnostics().profile,fog.id);
  assert.equal(s.weights(120000).day,1);
  assert.equal(s.weights(124000).day,.5);
  assert.equal(s.weights(124000)[fog.id],.5);
  assert.equal(s.weights(128000)[fog.id],1);
});
test('suspended or stale frames cannot count a long gap as persistent weather evidence',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples);
  s.observe(sun.signature,0);s.observe(fog.signature,5000);s.observe(fog.signature,130000);
  assert.equal(s.diagnostics().profile,sun.id);
  s.interrupt();s.observe(fog.signature,135000);assert.equal(s.diagnostics().profile,sun.id);
});
test('weather crossfades preserve opaque and feathered alpha at every intermediate step',()=>{
  const sources={day:new Uint8ClampedArray([80,50,20,255,100,70,30,90]),fog:new Uint8ClampedArray([180,170,150,255,180,160,140,90])};
  const out=new Uint8ClampedArray(8);
  for(let t=0;t<=1;t+=.05) {
    assert.equal(blendWeatherPixels(sources,{day:1-t,fog:t},out),true);
    assert.equal(out[3],255);assert.equal(out[7],90);
  }
});
test('exposure calibration follows the exact same profile weights as the photographic pixels',()=>{
  const sample={x:5,y:6,width:7,height:8,reference:[20,30,40],nightReference:[80,90,100]};
  const out=weatherSamples([sample],{day:[[20,30,40]],fog:[[60,70,80]]},{day:.25,fog:.75});
  assert.deepEqual(out[0].reference,[50,60,70]);assert.deepEqual(out[0].nightReference,sample.nightReference);
  assert.deepEqual(sample.reference,[20,30,40]);
});
test('scene descriptor ignores everything outside the selected static areas',()=>{
  const frame={width:4,height:4,data:new Uint8ClampedArray(4*4*4).fill(100)};
  const regions=[{x:0,y:0,width:2,height:2}];const before=describeWeather(frame,regions,4,4);
  frame.data.fill(255,2*4*4);
  assert.deepEqual(describeWeather(frame,regions,4,4),before);
});
