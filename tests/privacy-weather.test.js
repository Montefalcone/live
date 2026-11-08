import fs from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PRIVACY_WEATHER as catalog} from '../js/privacy-weather-catalog.js';
import {rankWeather,createWeatherSelector,blendWeatherPixels,weatherSamples,describeWeather,foregroundWeatherWeights} from '../js/privacy-weather.js';
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
test('a clear better reference switches at thirty seconds, with an eight-second RGB fade',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples);
  s.observe(sun.signature,0);
  for(let t=500;t<30000;t+=500) s.observe(fog.signature,t);
  assert.equal(s.diagnostics().profile,sun.id);assert.equal(s.diagnostics().checks,1);
  s.observe(fog.signature,30000);assert.equal(s.diagnostics().profile,fog.id);
  assert.equal(s.weights(30000).day,1);assert.equal(s.weights(34000).day,.5);
  assert.equal(s.weights(34000)[fog.id],.5);assert.equal(s.weights(38000)[fog.id],1);
  assert.equal(s.diagnostics().checks,2);
});
test('visibility changes and repeated reads cannot shorten the thirty-second interval',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples);
  s.observe(sun.signature,0);s.interrupt();s.observe(fog.signature,10000);
  assert.equal(s.diagnostics().checks,1);assert.equal(s.isDue(29999),false);
  assert.equal(s.isDue(30000),true);s.observe(fog.signature,30000);
  assert.equal(s.diagnostics().profile,fog.id);
});
test('marginal improvements need two thirty-second checks, not six obsolete five-second samples',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples,{strongMargin:1});
  s.observe(sun.signature,0);s.observe(fog.signature,30000);
  assert.equal(s.diagnostics().profile,sun.id);assert.equal(s.diagnostics().candidate,fog.id);
  s.observe(fog.signature,60000);assert.equal(s.diagnostics().profile,fog.id);
});
test('an interruption clears a borderline candidate without triggering an immediate recheck',()=>{
  const s=createWeatherSelector(catalog.profiles,catalog.samples,{strongMargin:1});
  s.observe(sun.signature,0);s.observe(fog.signature,30000);s.interrupt();
  s.observe(fog.signature,60000);assert.equal(s.diagnostics().profile,sun.id);
  s.observe(fog.signature,120000);assert.equal(s.diagnostics().profile,sun.id);
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
  previous.observe(sun.signature,0);previous.observe(observed,30000);
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
test('clear night and foggy night can switch both ways on the existing thirty-second cadence',()=>{
 const fogNight=catalog.profiles.find(p=>p.id==='fog-night');
 const night=catalog.profiles.find(p=>p.id==='night');
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 s.observe(night.signature,0,1);assert.equal(s.diagnostics().profile,'night');
 s.observe(fogNight.signature,30000,0);assert.equal(s.diagnostics().profile,'fog-night');
 s.weights(38000);
 s.observe(night.signature,60000,1);assert.equal(s.diagnostics().profile,'night');
 s.weights(68000);
 s.observe(sun.signature,90000,0);assert.equal(s.diagnostics().profile,'day');
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

test('shop light switches between the two fog photographs at the next thirty-second check',()=>{
 const on=catalog.profiles.find(p=>p.id==='fog-night'),off=catalog.profiles.find(p=>p.id==='fog-night-shop-off');
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 s.observe(on.signature,0,.15);
 s.observe(off.signature,29999,.15);assert.equal(s.diagnostics().profile,on.id);
 s.observe(off.signature,30000,.15);assert.equal(s.diagnostics().profile,off.id);
 assert.equal(s.weights(38000)[off.id],1);
 s.observe(on.signature,60000,.15);assert.equal(s.diagnostics().profile,on.id);
});
test('shop-light classification uses the live surroundings, not the old painted glow in the screenshot',()=>{
 const observed=JSON.parse(fs.readFileSync(new URL('./fixtures/weather-scene-20261107-shop-off.json',import.meta.url)));
 assert.equal(rank(observed).best,'fog-night-shop-off');
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 s.observe(catalog.profiles.find(p=>p.id==='fog-night').signature,0,.15);
 s.observe(observed,30000,.15);
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
test('confirmed foreground clearance escapes the fog cover before the thirty-second weather check',()=>{
 const fog=catalog.profiles.find(p=>p.id==='fog-night-shop-off'),clear=catalog.profiles.find(p=>p.id==='night');
 const lifted=catalog.samples.map((s,i)=>['sky','hills'].includes(s.group)?fog.signature[i]:clear.signature[i]);
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 s.observe(fog.signature,0,.1);
 for(let t=2000;t<=10000;t+=2000)s.observeClearance(lifted,t);
 assert.equal(s.diagnostics().profile,fog.id);
 s.observeClearance(lifted,12000);assert.equal(s.diagnostics().profile,'night');
 assert.equal(s.diagnostics().clearanceChanges,1);assert.equal(s.diagnostics().checks,1);
 assert.equal(s.diagnostics().nextCheckMs,30000);
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

const clearNight=catalog.profiles.find(p=>p.id==='night');
const fogOff=catalog.profiles.find(p=>p.id==='fog-night-shop-off');
function partialRoof(fraction){
 const signature=structuredClone(fogOff.signature);
 catalog.samples.forEach((sample,i)=>{if(sample.group==='roof') signature[i]={...signature[i],
   rgb:signature[i].rgb.map((v,c)=>clearNight.signature[i].rgb[c]*(1-fraction)+v*fraction),
   black:clearNight.signature[i].black*(1-fraction),contrast:signature[i].contrast};});
 return signature;
}
test('foreground cover follows partial roof clearance while distant buildings retain fog',()=>{
 for(const t of [0,.2,.4,.6,.8,1]){
  const weights=foregroundWeatherWeights(partialRoof(t),fogOff,catalog.profiles,catalog.samples);
  assert.ok(Math.abs((weights[fogOff.id]??0)-t)<1e-9);
  assert.ok(Math.abs(Object.values(weights).reduce((a,b)=>a+b,0)-1)<1e-9);
 }
});
test('November 8 screenshot keeps lighting choice but substantially reduces foreground haze',()=>{
 const signature=JSON.parse(fs.readFileSync(new URL('./fixtures/weather-scene-20261108.json',import.meta.url)));
 assert.equal(rank(signature).best,fogOff.id);
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 s.observe(fogOff.signature,0,.1);s.observe(signature,29999,.1);
 assert.equal(s.weights(29999)[fogOff.id],1);
 s.observe(signature,30000,.1);
 assert.equal(s.diagnostics().profile,fogOff.id);
 assert.ok(s.weights(38000).night>.7);
 assert.ok(s.weights(38000)[fogOff.id]>.05);
 assert.equal(s.diagnostics().intervalMs,30000);
});
test('foreground interpolation rejects insufficient, inconsistent, clipped and black evidence',()=>{
 const roof=catalog.samples.map((s,i)=>s.group==='roof'?i:-1).filter(i=>i>=0);
 for(const kind of ['missing','clipped','disagree','black']){
  const signature=structuredClone(fogOff.signature);
  if(kind==='black')signature.forEach(s=>{s.rgb=[0,0,0];s.black=1;});
  if(kind==='missing')roof.slice(0,2).forEach(i=>signature[i]=null);
  if(kind==='clipped')roof.slice(0,2).forEach(i=>signature[i].clipped=1);
  if(kind==='disagree')roof.forEach((i,j)=>signature[i]=partialRoof([0,.5,1][j])[i]);
  assert.deepEqual(foregroundWeatherWeights(signature,fogOff,catalog.profiles,catalog.samples),{[fogOff.id]:1},kind);
 }
 // One headlight cannot erase the two consistent foreground measurements.
 const signature=partialRoof(.2);signature[roof[0]]={rgb:[255,255,255],contrast:0,black:0,clipped:1};
 assert.ok(Math.abs(foregroundWeatherWeights(signature,fogOff,catalog.profiles,catalog.samples).night-.8)<1e-9);
});
test('partial foreground changes crossfade with constant coverage and matching exposure references',()=>{
 const s=createWeatherSelector(catalog.profiles,catalog.samples,catalog.settings);
 const sources={night:new Uint8ClampedArray([80,60,30,255,20,30,40,90]),[fogOff.id]:new Uint8ClampedArray([120,110,100,255,90,100,110,90])};
 s.observe(fogOff.signature,0,0);s.observe(partialRoof(.2),30000,0);
 for(let t=30000;t<=38000;t+=500){
  const weights=s.weights(t),out=new Uint8ClampedArray(8);
  blendWeatherPixels(sources,weights,out);assert.equal(out[3],255);assert.equal(out[7],90);
  assert.ok(out[0]>=88 && out[0]<=120);
 }
 assert.ok(Math.abs(s.weights(38000).night-.8)<1e-9);
});
