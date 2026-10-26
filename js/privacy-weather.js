// Visual reference matching, entirely local. Labels describe reference photos,
// not a meteorological measurement. Only available, validated artwork can win.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const light = a => .2126*a[0] + .7152*a[1] + .0722*a[2];
const median = a => { const b=[...a].sort((x,y)=>x-y); return b.length%2 ? b[b.length>>1] : (b[b.length/2-1]+b[b.length/2])/2; };

export function describeWeather(frame, samples, width, height) {
  return samples.map(s => {
    const x0=Math.ceil(s.x*frame.width/width), x1=Math.floor((s.x+s.width)*frame.width/width);
    const y0=Math.ceil(s.y*frame.height/height), y1=Math.floor((s.y+s.height)*frame.height/height);
    const rgb=[0,0,0], levels=[]; let black=0, clipped=0;
    for(let y=Math.max(0,y0);y<Math.min(frame.height,y1);y++) for(let x=Math.max(0,x0);x<Math.min(frame.width,x1);x++) {
      const p=(y*frame.width+x)*4, a=[frame.data[p],frame.data[p+1],frame.data[p+2]];
      if (!a.every(Number.isFinite)) continue;
      for(let c=0;c<3;c++) rgb[c]+=a[c];
      levels.push(light(a)); if(Math.max(...a)<16) black++; if(Math.min(...a)>250) clipped++;
    }
    if(!levels.length) return null;
    levels.sort((a,b)=>a-b); const n=levels.length;
    return {rgb:rgb.map(v=>v/n), contrast:levels[Math.floor((n-1)*.9)]-levels[Math.floor((n-1)*.1)], black:black/n, clipped:clipped/n};
  });
}

export function rankWeather(observed, profiles, samples, settings={}) {
  const results=[];
  for(const profile of profiles) {
    if(!profile.signature || profile.signature.length!==samples.length) continue;
    const usable=samples.map((s,i)=>i).filter(i=>observed[i] && profile.signature[i] && observed[i].black<.5 && observed[i].clipped<.8 && light(profile.signature[i].rgb)>15);
    if(usable.length<Math.ceil(samples.length*.7)) continue;
    const anchors=usable.filter(i=>samples[i].group==='walls');
    if(anchors.length<2) continue;
    const gain=clamp(median(anchors.map(i=>light(observed[i].rgb)/light(profile.signature[i].rgb))),.65,1.5);
    const groups={};
    for(const i of usable) {
      const a=observed[i],b=profile.signature[i], la=Math.max(15,light(a.rgb)), lb=Math.max(15,light(b.rgb));
      const exposure=Math.abs(Math.log(la/(lb*gain)));
      const color=a.rgb.reduce((sum,v,c)=>sum+Math.abs(v/la-b.rgb[c]/lb),0)/3;
      const contrast=Math.abs(Math.log((a.contrast/la+.06)/(b.contrast/lb+.06)));
      (groups[samples[i].group]??=[]).push(.5*exposure+.9*color+.25*contrast);
    }
    if(Object.keys(groups).length<3) continue;
    const weights={sky:.15,hills:.25,roof:.2,walls:.4}; let sum=0,total=0;
    for(const [group,values] of Object.entries(groups)) { const w=weights[group]??.1; sum+=median(values)*w; total+=w; }
    results.push({id:profile.id,label:profile.label,condition:profile.condition,score:sum/total});
  }
  results.sort((a,b)=>a.score-b.score);
  const first=results[0],second=results[1];
  const matched=Boolean(first && first.score<=(settings.maxScore??.42) && (!second || second.score-first.score>=(settings.margin??.035)));
  return {matched, best:matched?first.id:null,
    nearest:first && first.score<=(settings.maxScore??.42)?first.id:null, scores:results};
}

export function createWeatherSelector(profiles, samples, options={}) {
  let current=null, candidate=null, lastRead=null, checks=0;
  const intervalMs=options.intervalMs??300000;
  let weights={}, startWeights={}, fadeAt=null, report={matched:false,best:null,scores:[]};
  function blend(now) {
    if(fadeAt!==null) {
      const t=clamp((now-fadeAt)/(options.fadeMs??8000),0,1), k=t*t*(3-2*t);
      weights={};
      for(const p of profiles) weights[p.id]=(startWeights[p.id]??0)*(1-k)+(p.id===current?k:0);
      if(t===1) fadeAt=null;
    }
    return {...weights};
  }
  return {
    isDue(now) {return profiles.length>1 && (lastRead===null || now-lastRead>=intervalMs);},
    updateProfiles(next) {profiles=next;},
    observe(signature, now, nightMix=0) {
      blend(now);
      if(lastRead!==null && now-lastRead<intervalMs) return;
      if(lastRead!==null && now-lastRead>intervalMs*1.5) candidate=null;
      lastRead=now;checks++;
      if(nightMix>.25) {candidate=null;report={matched:false,best:null,scores:[]};return;}
      report=rankWeather(signature,profiles,samples,options);
      // An ambiguous weather label must not force the unrelated original photo.
      // Prefer the nearest credible photo; keep the classification uncertain.
      const preferred=report.best??report.nearest;
      if(current===null) {
        current=preferred??profiles[0]?.id; weights=current?{[current]:1}:{};
        return;
      }
      if(!preferred || preferred===current) {candidate=null;return;}
      // Require a meaningful improvement over the currently selected reference.
      const old=report.scores.find(p=>p.id===current),best=report.scores[0];
      const improvement=old?old.score-best.score:Infinity;
      if(improvement<(options.switchMargin??.06)) {candidate=null;return;}
      // Five-minute cadence already prevents rapid toggles. A clear winner can
      // correct the cover now; borderline changes need two consecutive checks.
      const strong=best.score<=(options.strongMaxScore??.25) && improvement>=(options.strongMargin??.10);
      if(!strong && candidate!==preferred) {candidate=preferred;return;}
      startWeights={...weights};current=preferred;fadeAt=now;candidate=null;
    },
    weights(now) { return blend(now); },
    interrupt() {candidate=null;},
    diagnostics() {return {profile:current,candidate,matched:report.matched,classification:report.matched?profiles.find(p=>p.id===report.best)?.condition:null,scores:report.scores.map(p=>({...p})),weights:{...weights},transition:fadeAt!==null,intervalMs,checks,lastCheckMs:lastRead,nextCheckMs:lastRead===null?null:lastRead+intervalMs};},
  };
}

// RGB crossfade with immutable coverage; never crossfade DOM/canvas opacity.
export function blendWeatherPixels(sources, weights, destination) {
  const entries=Object.entries(weights).filter(([id,w])=>w>0 && sources[id]);
  const total=entries.reduce((sum,[,w])=>sum+w,0);
  if(!total) return false;
  for(let p=0;p<destination.length;p+=4) {
    for(let c=0;c<3;c++) destination[p+c]=entries.reduce((sum,[id,w])=>sum+sources[id][p+c]*w,0)/total;
    destination[p+3]=sources[entries[0][0]][p+3];
  }
  return true;
}

export function weatherSamples(samples, profileSamples, weights) {
  return (samples??[]).map((sample,i)=> {
    const entries=Object.entries(weights).filter(([id,w])=>w>0 && profileSamples[id]?.[i]);
    const total=entries.reduce((sum,[,w])=>sum+w,0);
    return {...sample,reference:total?[0,1,2].map(c=>entries.reduce((sum,[id,w])=>sum+profileSamples[id][i][c]*w,0)/total):sample.reference};
  });
}
