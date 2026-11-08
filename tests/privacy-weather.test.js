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

test('foggy night is eligible even when illuminated fog makes the day/night ratio look like daytime',()=>{
 const fogNight=catalog.profiles.find(p=>p.id==='fog-night');
 for(const mix of [0,.5,1]) {
  const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
  s.observe(fogNight.signature,0,mix);
  assert.equal(s.diagnostics().profile,'fog-night');
 }
});
test('clear night and foggy night can switch both ways on the existing five-minute cadence',()=>{
 const fogNight=catalog.profiles.find(p=>p.id==='fog-night');
 const night=catalog.profiles.find(p=>p.id==='night');
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 s.observe(night.signature,0,1);assert.equal(s.diagnostics().profile,'night');
 s.observe(fogNight.signature,300000,0);assert.equal(s.diagnostics().profile,'fog-night');
 s.weights(308000);
 s.observe(night.signature,600000,1);assert.equal(s.diagnostics().profile,'night');
 s.weights(608000);
 s.observe(sun.signature,900000,0);assert.equal(s.diagnostics().profile,'day');
});
test('a full blackout cannot be classified as the clear-night reference',()=>{
 const blank=catalog.samples.map(()=>({rgb:[0,0,0],contrast:0,black:1,clipped:0}));
 assert.equal(rank(blank).matched,false);
});
test('night-specific photography is not mixed back with the old clear-night artwork',async()=>{
 const {weatherNightMix}=await import('../js/privacy-weather.js');
 assert.equal(weatherNightMix(1,{'fog-night':1},catalog.profiles),0);
 assert.equal(weatherNightMix(.8,{'fog-night':.5,day:.5},catalog.profiles),.4);
 assert.equal(weatherNightMix(.8,{day:1},catalog.profiles),.8);
 assert.equal(weatherNightMix(.8,{},catalog.profiles),.8);
});
test('independent November 7 player screenshot selects fog-night with existing covers masked out',()=>{
 const observed=JSON.parse(fs.readFileSync(new URL('./fixtures/weather-scene-20261107.json',import.meta.url)));
 assert.equal(rank(observed).best,'fog-night');
});

test('shop light switches between the two fog photographs at the next five-minute check',()=>{
 const on=catalog.profiles.find(p=>p.id==='fog-night'),off=catalog.profiles.find(p=>p.id==='fog-night-shop-off');
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 s.observe(on.signature,0,.15);
 s.observe(off.signature,299999,.15);assert.equal(s.diagnostics().profile,on.id);
 s.observe(off.signature,300000,.15);assert.equal(s.diagnostics().profile,off.id);
 assert.equal(s.weights(308000)[off.id],1);
 s.observe(on.signature,600000,.15);assert.equal(s.diagnostics().profile,on.id);
});
test('shop-light classification uses the live surroundings, not the old painted glow in the screenshot',()=>{
 const observed=JSON.parse(fs.readFileSync(new URL('./fixtures/weather-scene-20261107-shop-off.json',import.meta.url)));
 assert.equal(rank(observed).best,'fog-night-shop-off');
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 s.observe(catalog.profiles.find(p=>p.id==='fog-night').signature,0,.15);
 s.observe(observed,300000,.15);
 assert.equal(s.diagnostics().profile,'fog-night-shop-off');
});
test('one bright headlight or dark occluder in a lighting sample cannot select the wrong shop state',()=>{
 const indices=catalog.samples.map((s,i)=>s.group==='shop-light'?i:-1).filter(i=>i>=0);
 for(const id of ['fog-night','fog-night-shop-off'])for(const index of indices)for(const rgb of [[240,240,240],[25,25,25]]){
  const observed=structuredClone(catalog.profiles.find(p=>p.id===id).signature);
  observed[index]={rgb,contrast:30,black:0,clipped:0};
  assert.equal(rank(observed).best,id);
 }
});

test('fog confined to sky/hills cannot retain fog on clear foreground buildings',()=>{
 const fogNight=catalog.profiles.find(p=>p.id==='fog-night-shop-off'),clear=catalog.profiles.find(p=>p.id==='night');
 const lifted=catalog.samples.map((s,i)=>['sky','hills'].includes(s.group)?fogNight.signature[i]:clear.signature[i]);
 assert.equal(rank(lifted).best,'night');
 const onlySkyClear=catalog.samples.map((s,i)=>['sky','hills'].includes(s.group)?clear.signature[i]:fogNight.signature[i]);
 assert.equal(rank(onlySkyClear).best,'fog-night-shop-off');
});
test('confirmed foreground clearance escapes the fog cover before the five-minute weather check',()=>{
 const fog=catalog.profiles.find(p=>p.id==='fog-night-shop-off'),clear=catalog.profiles.find(p=>p.id==='night');
 const lifted=catalog.samples.map((s,i)=>['sky','hills'].includes(s.group)?fog.signature[i]:clear.signature[i]);
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 s.observe(fog.signature,0,.1);
 for(let t=2000;t<=10000;t+=2000)s.observeClearance(lifted,t);
 assert.equal(s.diagnostics().profile,fog.id);
 s.observeClearance(lifted,12000);assert.equal(s.diagnostics().profile,'night');
 assert.equal(s.diagnostics().clearanceChanges,1);assert.equal(s.diagnostics().checks,1);
 assert.equal(s.diagnostics().nextCheckMs,300000);
 assert.equal(s.weights(16000).night,.5);assert.equal(s.weights(20000).night,1);
});
test('a transient clear-looking frame, blackout, interruption or long frame gap cannot clear fog',()=>{
 const fog=catalog.profiles.find(p=>p.id==='fog-night-shop-off'),clear=catalog.profiles.find(p=>p.id==='night');
 for(const disturbance of ['fog','black','pause','gap']){
  const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);s.observe(fog.signature,0,.1);
  s.observeClearance(clear.signature,2000);s.observeClearance(clear.signature,4000);
  if(disturbance==='pause')s.interrupt();
  if(disturbance==='fog')s.observeClearance(fog.signature,6000);
  if(disturbance==='black')s.observeClearance(catalog.samples.map(()=>null),6000);
  s.observeClearance(clear.signature,16000);
  assert.equal(s.diagnostics().profile,fog.id,disturbance);
 }
});
