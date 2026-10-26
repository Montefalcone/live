import fs from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PRIVACY_WEATHER as catalog} from '../js/privacy-weather-catalog.js';
import {rankWeather,createWeatherSelector,blendWeatherPixels,weatherSamples,describeWeather} from '../js/privacy-weather.js';
const sun=catalog.profiles.find(p=>p.id==='day'),fog=catalog.profiles.find(p=>p.id==='light-fog-morning');
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
test('a clear better reference switches at five minutes, with an eight-second RGB fade',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples);
  s.observe(sun.signature,0);
  for(let t=500;t<300000;t+=500) s.observe(fog.signature,t);
  assert.equal(s.diagnostics().profile,sun.id);assert.equal(s.diagnostics().checks,1);
  s.observe(fog.signature,300000);assert.equal(s.diagnostics().profile,fog.id);
  assert.equal(s.weights(300000).day,1);assert.equal(s.weights(304000).day,.5);
  assert.equal(s.weights(304000)[fog.id],.5);assert.equal(s.weights(308000)[fog.id],1);
  assert.equal(s.diagnostics().checks,2);
});
test('visibility changes and repeated reads cannot shorten the five-minute interval',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples);
  s.observe(sun.signature,0);s.interrupt();s.observe(fog.signature,10000);
  assert.equal(s.diagnostics().checks,1);assert.equal(s.isDue(299999),false);
  assert.equal(s.isDue(300000),true);s.observe(fog.signature,300000);
  assert.equal(s.diagnostics().profile,fog.id);
});
test('marginal improvements need two five-minute checks, not six obsolete five-second samples',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples,{strongMargin:1});
  s.observe(sun.signature,0);s.observe(fog.signature,300000);
  assert.equal(s.diagnostics().profile,sun.id);assert.equal(s.diagnostics().candidate,fog.id);
  s.observe(fog.signature,600000);assert.equal(s.diagnostics().profile,fog.id);
});
test('an interruption clears a borderline candidate without triggering an immediate recheck',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples,{strongMargin:1});
  s.observe(sun.signature,0);s.observe(fog.signature,300000);s.interrupt();
  s.observe(fog.signature,600000);assert.equal(s.diagnostics().profile,sun.id);
  s.observe(fog.signature,1200000);assert.equal(s.diagnostics().profile,sun.id);
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

test('reported October 22 scene chooses the fog photograph even if the weather label is ambiguous',()=>{
  const observed=JSON.parse(fs.readFileSync(new URL('./fixtures/weather-scene-20261022.json',import.meta.url)));
  const s=createWeatherSelector(catalog.profiles,catalog.samples);
  s.observe(observed,0);assert.equal(s.diagnostics().profile,'light-fog-morning');
  const previous=createWeatherSelector(catalog.profiles,catalog.samples);
  previous.observe(sun.signature,0);previous.observe(observed,300000);
  assert.equal(previous.diagnostics().profile,'light-fog-morning');
});
test('a late downloaded profile joins an existing selector without resetting the cadence',()=>{
  const s=createWeatherSelector([sun],catalog.samples);assert.equal(s.isDue(0),false);
  s.updateProfiles(catalog.profiles);assert.equal(s.isDue(0),true);
  s.observe(fog.signature,0);assert.equal(s.diagnostics().profile,fog.id);
  s.updateProfiles(catalog.profiles);assert.equal(s.isDue(5000),false);
});
