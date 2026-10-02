const test = require('node:test');
const assert = require('node:assert/strict');
const { placeSeatedForwardReachTargets, placeReachLadderTargets, fitSeatedForwardReachTargets, screenDistance, wristContact } = require('../reach_target.js');
const near = (a, b) => assert.ok(Math.abs(a-b)<1e-10, `${a} != ${b}`);

test('only the affected pose wrist counts, including the drawn boundary on portrait and landscape',()=>{
  for(const side of ['left','right'])for(const aspect of [16/9,4/3,3/4,9/16]){
    const target={x:.4,y:.65},radius=.1,wi=side==='left'?15:16;
    // Other wrist and every fingertip are inside while the selected wrist is outside.
    const p=Array.from({length:33},()=>({...target,visibility:1}));
    p[wi]={x:.75,y:.65,visibility:1};
    assert.ok(wristContact({landmarks:p,side,target,aspect}).distance>radius);
    p[wi]={x:target.x+radius/Math.max(1,aspect),y:target.y,visibility:1};
    near(wristContact({landmarks:p,side,target,aspect}).distance,radius);
    p[wi].x+=.001;assert.ok(wristContact({landmarks:p,side,target,aspect}).distance>radius);
    p[wi]={...target,visibility:1};assert.equal(wristContact({landmarks:p,side,target,aspect}).distance,0);
    p[wi].visibility=.2;assert.equal(wristContact({landmarks:p,side,target,aspect}).distance,Infinity);
    p[wi]={...target,visibility:1,presence:.1};assert.equal(wristContact({landmarks:p,side,target,aspect}).distance,Infinity);
    p[wi].x=NaN;assert.equal(wristContact({landmarks:p,side,target,aspect}).point,null);
  }
  assert.equal(wristContact({landmarks:null,target:{x:.5,y:.5}}).distance,Infinity);
});

test('start follows lap; raise and hold follow shoulder, for either relative X ordering', () => {
  for (const aspect of [16/9,4/3,9/16]) for (const [lapX,shoulderX] of [[.43,.57],[.60,.42]]) {
    const lap={x:lapX,y:.77}, shoulder={x:shoulderX,y:.28};
    const p=placeSeatedForwardReachTargets({lap,shoulder,shoulderWidth:.24,radius:.11,aspect});
    assert.equal(p.ready,true);
    near(p.start.y,lap.y);near(p.raised.y,shoulder.y);
    near(p.start.x-lap.x,p.raised.x-shoulder.x);
    near(p.gap,.24*.45);
    assert.ok(p.start.x-p.radiusX*1.08>lap.x);
    assert.ok(p.raised.x-p.radiusX*1.08>shoulder.x);
    // The contact boundary clears each anchor, not merely the circle centre.
    assert.ok(screenDistance(lap,p.start,aspect)>p.radius);
    assert.ok(screenDistance(shoulder,p.raised,aspect)>p.radius);
    assert.ok(p.start.x+p.radiusX*1.08<=.975);
    assert.ok(p.raised.x+p.radiusX*1.08<=.975);
  }
});

test('refuse insufficient horizontal or vertical room instead of changing the anchor', () => {
  const base={lap:{x:.48,y:.77},shoulder:{x:.56,y:.28},shoulderWidth:.24,radius:.11,aspect:4/3};
  assert.equal(placeSeatedForwardReachTargets({...base,rightEdge:.7}).reason,'need_room_right');
  assert.equal(placeSeatedForwardReachTargets({...base,lap:{x:.9,y:.77}}).anchor,'lap');
  assert.equal(placeSeatedForwardReachTargets({...base,shoulder:{x:.9,y:.28}}).anchor,'shoulder');
  assert.equal(placeSeatedForwardReachTargets({...base,lap:{x:.48,y:.94}}).reason,'need_vertical_room');
  assert.equal(placeSeatedForwardReachTargets({...base,topEdge:.25}).reason,'need_vertical_room');
  assert.equal(placeSeatedForwardReachTargets({...base,bottomEdge:.83}).reason,'need_vertical_room');
  assert.equal(placeSeatedForwardReachTargets({...base,shoulder:null}).ready,false);
});

test('keep the original anchor heights when a generous forward circle already fits', () => {
  const base={lap:{x:.53,y:.84},shoulder:{x:.50,y:.28},shoulderWidth:.28,radius:.154,aspect:16/9};
  assert.equal(placeSeatedForwardReachTargets(base).reason,'need_vertical_room');
  const fitted=fitSeatedForwardReachTargets(base);
  assert.equal(fitted.ready,true);
  assert.equal(fitted.fitted,true);
  assert.ok(fitted.radius>.12 && fitted.radius<base.radius);
  near(fitted.start.y,base.lap.y);
  near(fitted.raised.y,base.shoulder.y);
  assert.ok(fitted.start.x-fitted.radiusX*1.08>base.lap.x);
  assert.ok(fitted.raised.x-fitted.radiusX*1.08>base.shoulder.x);
  assert.ok(fitted.start.y+fitted.radiusY*1.08<=.975);
  assert.ok(fitted.raised.y-fitted.radiusY*1.08>=.025);
  assert.equal(fitSeatedForwardReachTargets({...base,radius:.09}).fitted,undefined);
});

test('a low visible lap fits a smaller return ring and a slightly raised first circle', () => {
  const base={lap:{x:.53,y:.94},shoulder:{x:.50,y:.28},shoulderWidth:.28,radius:.154,aspect:16/9};
  const result=fitSeatedForwardReachTargets(base);
  assert.equal(result.ready,true);
  assert.equal(result.fitted,true);
  assert.ok(result.radius>.10);
  assert.ok(result.lapRadius>.04 && result.lapRadius<result.radius);
  assert.ok(result.start.y<base.lap.y && base.lap.y-result.start.y<.08);
  assert.ok(result.start.y+result.radiusY*1.08<=.975);
  assert.ok(base.lap.y+result.lapRadius*1.08<=.99);
  assert.ok(result.start.x-result.radiusX*1.08>base.lap.x);
});

test('a lap point at the very edge still asks for reframing', () => {
  const base={lap:{x:.53,y:.99},shoulder:{x:.50,y:.28},shoulderWidth:.28,radius:.154,aspect:16/9};
  const result=fitSeatedForwardReachTargets(base);
  assert.equal(result.ready,false);
  assert.equal(result.reason,'need_vertical_room');
  assert.match(result.guidance,/Tilt the camera/);
});

test('lap-return circle shrinks near an edge and grows back when the hand is central', () => {
  const base={shoulder:{x:.5,y:.28},shoulderWidth:.24,radius:.11,aspect:4/3};
  const edge=fitSeatedForwardReachTargets({...base,lap:{x:.08,y:.77}});
  const centre=fitSeatedForwardReachTargets({...base,lap:{x:.38,y:.77}});
  assert.equal(edge.ready,true);
  assert.equal(centre.ready,true);
  assert.ok(edge.lapRadius<centre.radius);
  near(centre.radius,base.radius);
  assert.ok(edge.start.x-edge.radiusX*1.08>0);
  assert.ok(.08-edge.lapRadius/Math.max(base.aspect,1)*1.08>=.01-1e-9);
});

test('160% reach fits completely above the shoulder in landscape and portrait views',()=>{
  for(const aspect of [16/9,4/3,9/16]){
    const options={lap:{x:.35,y:.8},shoulder:{x:.4,y:.5},shoulderWidth:.2,radius:.11,aspect,maxHeight:1.6};
    const result=fitSeatedForwardReachTargets(options);
    assert.equal(result.ready,true);near(result.raised.y,.5);
    const highest=options.lap.y+(result.raised.y-options.lap.y)*1.6;
    near(highest,.32);assert.ok(highest-result.radiusY*1.08>=.025);
  }
});
test('a higher rung outside the camera or portrait crop requests framing without lowering it',()=>{
  const base={lap:{x:.35,y:.8},shoulder:{x:.4,y:.3},shoulderWidth:.2,radius:.11,aspect:4/3};
  assert.equal(fitSeatedForwardReachTargets(base).ready,true,'The old shoulder-height target fits');
  for(const options of [{...base,maxHeight:1.6},{...base,shoulder:{x:.4,y:.5},maxHeight:1.6,topEdge:.35}]){
    const result=fitSeatedForwardReachTargets(options);
    assert.equal(result.ready,false);assert.equal(result.reason,'need_vertical_room');
    assert.match(result.guidance,/higher reach circle/);
  }
});

test('large ladder circles fit the actual three reach heights independently of a low lap return',()=>{
  for(const aspect of [16/9,4/3,3/4,9/16]){
    const options={lap:{x:.4,y:.9},shoulder:{x:.4,y:.6},shoulderWidth:.2,
      radius:.14,aspect,minHeight:.8,maxHeight:1.6,fitLap:false};
    const result=fitSeatedForwardReachTargets(options,.14);
    assert.equal(result.ready,true);assert.equal(result.radius,.14);
    for(const height of [.8,1.2,1.6]){
      const y=options.lap.y+(result.raised.y-options.lap.y)*height;
      assert.ok(y-result.radiusY*1.08>=.025);
      assert.ok(y+result.radiusY*1.08<=.975);
    }
    const clipped=fitSeatedForwardReachTargets({...options,shoulder:{x:.4,y:.4}},.14);
    assert.equal(clipped.ready,false,'The full circle at the highest target must remain visible');
    assert.equal(clipped.reason,'need_vertical_room');
  }
});

test('the three large ladder circles retain their heights and have disjoint hit areas',()=>{
  for(const aspect of [16/9,4/3,3/4,9/16]){
    const options={lap:{x:.2,y:.9},shoulder:{x:.2,y:.6},shoulderWidth:.2,
      radius:.14,aspect,minHeight:.8,maxHeight:1.6,fitLap:false};
    const placement=fitSeatedForwardReachTargets(options,.14),heights={r80:.8,r120:1.2,r160:1.6};
    const result=placeReachLadderTargets({placement,lap:options.lap,heights,aspect});
    assert.equal(result.ready,true);assert.equal(result.radius,.14);
    const targets=Object.entries(result.rungTargets);
    for(const [rung,target] of targets){
      near(target.y,options.lap.y+(options.shoulder.y-options.lap.y)*heights[rung]);
      assert.ok(target.x+result.radiusX*1.08<=.975);
    }
    for(let a=0;a<targets.length;a++)for(let b=a+1;b<targets.length;b++)
      assert.ok(screenDistance(targets[a][1],targets[b][1],aspect)>result.radius*2);
    const clipped=placeReachLadderTargets({placement,lap:options.lap,heights,aspect,rightEdge:placement.radiusX*2+.05});
    assert.equal(clipped.ready,false);assert.equal(clipped.reason,'need_room_reach_ladder');
    assert.match(clipped.guidance,/three large reach circles/);
  }
});

test('ladder-only horizontal packing fits centered patients while original task geometry stays unchanged',()=>{
  for(const aspect of [16/9,4/3,3/4]){
    const options={lap:{x:.57,y:.76},shoulder:{x:.6,y:.4},shoulderWidth:.2,
      radius:.14,aspect,minHeight:.8,maxHeight:1.6,fitLap:false};
    const placement=fitSeatedForwardReachTargets({...options,allowHorizontalShift:true},.14);
    const result=placeReachLadderTargets({placement,lap:options.lap,heights:{r80:.8,r120:1.2,r160:1.6},aspect});
    assert.equal(result.ready,true);assert.equal(result.radius,.14);
    for(const [rung,point] of Object.entries(result.rungTargets)){
      near(point.y,options.lap.y+(options.shoulder.y-options.lap.y)*({r80:.8,r120:1.2,r160:1.6}[rung]));
      assert.ok(point.x-result.radiusX*1.08>=.025-1e-9);
      assert.ok(point.x+result.radiusX*1.08<=.975+1e-9);
    }
  }
  const narrow=placeSeatedForwardReachTargets({lap:{x:.7,y:.8},shoulder:{x:.7,y:.5},shoulderWidth:.2,radius:.14,aspect:1});
  assert.equal(narrow.ready,false,'Original Testing tasks still require space beside the arm');
  assert.equal(narrow.reason,'need_room_right');
});

test('tiny shoulder noise cannot flip the reach layout to another horizontal ordering',()=>{
  let previous=null;
  for(let i=0;i<50;i++){
    const d=i%2?.0001:-.0001,lap={x:.43,y:.76};
    const placement=fitSeatedForwardReachTargets({lap,shoulder:{x:.4+d,y:.4+d},
      shoulderWidth:.2+d,radius:.14+d,aspect:4/3,minHeight:.8,maxHeight:1.6,
      fitLap:false,allowHorizontalShift:true},.14+d);
    const result=placeReachLadderTargets({placement,lap,heights:{r80:.8,r120:1.2,r160:1.6},
      aspect:4/3,preferredOrder:previous?.layoutOrder});
    assert.equal(result.ready,true);
    if(previous){
      assert.deepEqual(result.layoutOrder,previous.layoutOrder);
      for(const rung of ['r80','r120','r160'])
        assert.ok(screenDistance(result.rungTargets[rung],previous.rungTargets[rung],4/3)<.003);
    }
    previous=result;
  }
});
