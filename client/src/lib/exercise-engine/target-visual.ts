import { TARGET_COMPLETION_MS } from "./target-timing";

type TargetOptions = { x: number; y: number; radius: number; now?: number; contact?: boolean; muted?: boolean; reducedMotion?: boolean; elapsed?: number; mirrored?: boolean; armed?: boolean; progress?: number };
  function drawBreathingHalo(ctx: CanvasRenderingContext2D, {x, y, radius, now = 0, contact = false, muted = false, reducedMotion = false}: TargetOptions) {
    const breath = reducedMotion ? .5 : (1 - Math.cos(now * Math.PI * 2 / 2800)) / 2;
    const rgb = contact ? '127,229,163' : '225,142,109';
    const strength = muted ? .55 : 1;
    ctx.save();ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(x,y,radius*(.98+.08*breath),0,Math.PI*2);
    ctx.lineWidth=5+5*breath;
    ctx.strokeStyle=`rgba(${rgb},${strength*(.09+.13*breath)})`;
    ctx.shadowColor=`rgba(${rgb},${strength*.6})`;ctx.shadowBlur=8+10*breath;
    ctx.stroke();ctx.shadowBlur=0;
    ctx.beginPath();ctx.arc(x,y,radius*(.72+.14*breath),0,Math.PI*2);
    ctx.fillStyle=`rgba(${rgb},${strength*(.025+.035*breath)})`;ctx.fill();
    ctx.restore();
  }
  export function drawTargetCompletion(ctx: CanvasRenderingContext2D, {x, y, radius, elapsed = 0, reducedMotion = false, mirrored = false}: TargetOptions) {
    if(elapsed < 0 || elapsed >= TARGET_COMPLETION_MS) return;
    const t = elapsed / TARGET_COMPLETION_MS;
    const ease = 1-Math.pow(1-t,3);
    const fade = reducedMotion ? 1 : Math.min(1,(1-t)/.25);
    ctx.save();ctx.setLineDash([]);ctx.globalAlpha=fade;
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);
    ctx.fillStyle='rgba(63,168,110,0.22)';ctx.fill();
    ctx.strokeStyle='#7FE5A3';ctx.lineWidth=6;
    ctx.shadowColor='#7FE5A3';ctx.shadowBlur=reducedMotion?0:18*(1-t);ctx.stroke();ctx.shadowBlur=0;
    if(!reducedMotion){
      // Two soft ripples release outward as the completed ring settles.
      for(const lag of [0,.18]){
        const p=Math.max(0,Math.min(1,(t-lag)/(1-lag)));
        if(t<lag)continue;
        ctx.beginPath();ctx.arc(x,y,radius*(1+.28*(1-Math.pow(1-p,2))),0,Math.PI*2);
        ctx.strokeStyle=`rgba(127,229,163,${.5*(1-p)})`;ctx.lineWidth=3*(1-p)+1;ctx.stroke();
      }
    }
    // Draw one check in screen orientation, including on the mirrored camera.
    ctx.translate(x,y);if(mirrored)ctx.scale(-1,1);
    const scale=reducedMotion?1:.82+.18*ease;ctx.scale(scale,scale);
    const points=[[-.30,0],[-.07,.23],[.34,-.25]];
    const reveal=reducedMotion?1:Math.min(1,elapsed/240);
    ctx.beginPath();ctx.moveTo(points[0][0]*radius,points[0][1]*radius);
    for(let i=1;i<points.length;i++){
      const part=Math.max(0,Math.min(1,reveal*2-(i-1)));
      ctx.lineTo((points[i-1][0]+(points[i][0]-points[i-1][0])*part)*radius,
        (points[i-1][1]+(points[i][1]-points[i-1][1])*part)*radius);
    }
    ctx.strokeStyle='#E2FFEA';ctx.lineWidth=Math.max(4,radius*.085);ctx.stroke();ctx.restore();
  }
  // One visual contract for both seated Testing tasks. The outer boundary is
  // fixed at the contact radius; progress stays inside it and never enlarges it.
  export function drawTestingTarget(ctx: CanvasRenderingContext2D, {x, y, radius, armed, contact, progress = 0, now = 0, reducedMotion = false}: TargetOptions) {
    contact = Boolean(armed && contact);
    ctx.save();
    ctx.setLineDash(armed ? [] : [10, 8]);
    ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);
    ctx.lineWidth=6;
    ctx.strokeStyle=armed ? contact ? '#7FE5A3' : '#E18E6D' : 'rgba(225,142,109,0.45)';
    ctx.stroke();ctx.setLineDash([]);
    if(armed){
      ctx.beginPath();ctx.arc(x,y,radius*.55,0,Math.PI*2);
      ctx.fillStyle=contact ? 'rgba(127,229,163,0.4)' : 'rgba(225,142,109,0.4)';ctx.fill();
    }
    ctx.beginPath();ctx.arc(x,y,Math.max(5,Math.min(10,radius*.16)),0,Math.PI*2);
    ctx.fillStyle=armed ? '#fff' : 'rgba(255,255,255,0.8)';ctx.fill();
    if(armed && progress>0){
      ctx.beginPath();ctx.arc(x,y,radius*.82,-Math.PI/2,-Math.PI/2+Math.min(1,progress)*Math.PI*2);
      ctx.strokeStyle='#3C8255';ctx.lineWidth=8;ctx.stroke();
    }
    ctx.restore();
    drawBreathingHalo(ctx,{x,y,radius,now,contact,muted:!armed,reducedMotion});
  }
