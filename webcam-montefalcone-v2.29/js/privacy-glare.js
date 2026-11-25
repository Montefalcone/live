// Local magenta-flare suppression on the small roof only. No facade white balance.
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = v => { const t=clamp(v); return t*t*(3-2*t); };
function inside(x,y,poly) {
  let yes=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) yes=!yes;
  }
  return yes;
}
function distance(x,y,poly) {
  let best=Infinity;
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1];
    const t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1));
    best=Math.min(best,Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t));
  }
  return best;
}
export function prepareRoofGlare(region,patch) {
  const spec=region.roofGlare;if(!spec)return null;
  const poly=spec.polygon;
  const x=Math.max(patch.x,Math.floor(Math.min(...poly.map(p=>p[0]))));
  const y=Math.max(patch.y,Math.floor(Math.min(...poly.map(p=>p[1]))));
  const width=Math.min(patch.x+patch.width,Math.ceil(Math.max(...poly.map(p=>p[0]))))-x;
  const height=Math.min(patch.y+patch.height,Math.ceil(Math.max(...poly.map(p=>p[1]))))-y;
  const offsets=[],sources=[],weights=[];
  for(let row=0;row<height;row++)for(let col=0;col<width;col++) {
    const gx=x+col+.5,gy=y+row+.5;if(!inside(gx,gy,poly))continue;
    offsets.push(((y+row-patch.y)*patch.width+x+col-patch.x)*4);
    sources.push((row*width+col)*4);
    weights.push(smooth(distance(gx,gy,poly)/(spec.feather??3)));
  }
  return {source:{x,y,width,height},offsets:Uint32Array.from(offsets),sources:Uint32Array.from(sources),weights:Float32Array.from(weights)};
}
export function reduceMagenta(r,g,b,weight=1) {
  // Bound excess red continuously (no binary per-pixel selection). Blue excess
  // is removed only in warm pixels, so neutral/blue highlights stay unchanged.
  // The green-channel texture remains intact; no grayscale conversion.
  if(weight<=0 || g<6 || g>235)return [r,g,b];
  const redExcess=Math.max(0,r-(1.35*g+1));
  const warm=smooth((r-1.15*g-2)/8);
  const blueExcess=Math.max(0,b-(.86*g+1))*warm;
  return [r-redExcess*weight,g,b-blueExcess*weight];
}
export function applyRoofGlare(destination,glare,frame=null) {
  if(!glare)return 0;
  const s=glare.source;
  const live=frame?.width===s.width && frame?.height===s.height && frame.data?.length===s.width*s.height*4 ? frame.data : null;
  let changed=0;
  for(let i=0;i<glare.offsets.length;i++) {
    const p=glare.offsets[i],q=glare.sources[i],a=destination[p+3]/255;
    if(a<1&&!live)continue;
    const rgb=[0,1,2].map(c=>destination[p+c]*a+(live?.[q+c]??0)*(1-a));
    const fixed=reduceMagenta(...rgb,glare.weights[i]);
    if(Math.max(...rgb.map((v,c)=>Math.abs(v-fixed[c])))<.5)continue;
    for(let c=0;c<3;c++)destination[p+c]=fixed[c];
    // Flatten against already-masked public video. Never lower existing alpha.
    destination[p+3]=255;changed++;
  }
  return changed;
}
