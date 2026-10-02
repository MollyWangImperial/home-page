const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.py'),'utf8').replaceAll('\r\n','\n');
const mouth=fs.readFileSync(require.resolve('../testing_mouth_flow.js'),'utf8');
function fn(text,name){
  const start=text.indexOf('function '+name+'(');assert.ok(start>=0,name);
  const line=text.slice(start,text.indexOf('\n',start));
  return line.endsWith('}')?line:text.slice(start,text.indexOf('\n}',start)+2);
}
function fixture(side='right',aspect=4/3){
  const c={AFFECTED_SIDE:side,video:{videoWidth:480*aspect,videoHeight:480},lastPoseScanTs:1,
    latestHandLandmarks:null,latestHandSeenAt:0,performance:{now:()=>2000},handLandmarkFreshMs:()=>220,
    handToMouthTaskEnabled:()=>true,testingMouthEnabled:()=>false,testingReachEnabled:()=>false,functionLadderActive:()=>false,
    isLapTarget:()=>false,isForwardReachTarget:()=>false,isCenteredArmStartStep:()=>false,isHandTask:()=>false,
    voiceFinishedAt:1000,effectiveRadius:()=>.06,RehynReachTarget:require('../reach_target.js')};
  vm.createContext(c);
  const names=['newMouthTargetCalibration','poseMouthTarget','updateMouthTargetCalibration','landmarkIsUsable',
    'midpoint','medianValue','shoulderWidth','distXY','affectedPoseHandPoints','affectedMouthContactPoints',
    'rawHandPalmCenter','getEffectiveTargetXY','targetCanvasPoint','isMouthTarget','checkTarget'];
  vm.runInContext(names.map(n=>fn(source,n)).join('\n')+'\n'+['mouthScreenDistance','testingMouthContact'].map(n=>fn(mouth,n)).join('\n'),c);
  c.mouthTargetCalibration=c.newMouthTargetCalibration();
  c.step={id:'T3-S2',target:{landmark:'MOUTH',x:.5,y:.3,r:.06}};c.getCurrentStep=()=>c.step;
  c.pose=(x=.39,y=.42)=>{
    const p=Array.from({length:33},()=>({x:.2,y:.8,visibility:.99,presence:.99}));
    p[9]={x:x-.025,y,visibility:.99};p[10]={x:x+.025,y,visibility:.99};
    p[11]={x:.3,y:.55,visibility:.99};p[12]={x:.7,y:.55,visibility:.99};return p;
  };
  c.feed=(p,n=10)=>{for(let i=0;i<n;i++){c.latestPoseLandmarks=p;c.lastPoseScanTs++;c.updateMouthTargetCalibration(p,c.lastPoseScanTs);}};
  return c;
}
test('a mouth target follows a changed seated position after its first lock',()=>{
  for(const side of ['left','right'])for(const aspect of [16/9,3/4]){
    const c=fixture(side,aspect);c.feed(c.pose());assert.equal(c.mouthTargetCalibration.locked,true);
    const shifted=c.pose(.46,.29);c.feed(shifted);
    const target=c.getEffectiveTargetXY(c.step),drawn=c.targetCanvasPoint(c.step,target);
    assert.ok(Math.abs(drawn.x-.46)<1e-9);assert.equal(drawn.y,.29,'Target follows the lips, not the old chin position');
    assert.equal(drawn.x,target.x,'CSS mirrors the video and target exactly once');
    const old={...drawn,y:.42},wi=side==='left'?16:15,fi=side==='left'?19:20;
    shifted[wi]={...drawn,visibility:1};
    assert.equal(c.checkTarget(shifted),false,'Unaffected hand at mouth cannot activate');
    shifted[fi]={...old,visibility:1};assert.equal(c.checkTarget(shifted),false,'Old target cannot activate');
    shifted[fi]={...drawn,visibility:1};assert.equal(c.checkTarget(shifted),true,'Affected fingertip at the drawn mouth activates');
  }
});
test('mouth tracking ignores one-frame jumps and freezes while either hand occludes the lips',()=>{
  for(const handIndex of [19,20]){
    const c=fixture();c.feed(c.pose());const locked={...c.mouthTargetCalibration.target};
    c.feed(c.pose(.39,.6),1);assert.equal(c.mouthTargetCalibration.target.y,locked.y);
    const covered=c.pose(.39,.6);covered[handIndex]={...locked,visibility:1};
    c.feed(covered,20);assert.equal(c.mouthTargetCalibration.target.y,locked.y,'Occlusion cannot pull the ring down');
    const clear=c.pose(.45,.3);c.feed(clear,4);assert.equal(c.mouthTargetCalibration.target.y,locked.y);
    c.feed(clear,1);assert.equal(c.mouthTargetCalibration.target.y,.3,'Reacquire after five clear frames');
  }
});
test('invalid or duplicate frames cannot calibrate a mouth, and there is no static fallback',()=>{
  const c=fixture(),missing=c.pose();missing[9].visibility=0;
  c.feed(missing);assert.equal(c.getEffectiveTargetXY(c.step),null);assert.equal(c.mouthTargetCalibration.locked,false);
  const p=c.pose();for(let i=0;i<10;i++)c.updateMouthTargetCalibration(p,100);
  assert.equal(c.mouthTargetCalibration.locked,false);assert.equal(c.mouthTargetCalibration.samples.length,1);
});

test('local fixed-mouth testing keeps the first calibrated point through head movement and occlusion',()=>{
  for(const side of ['left','right'])for(const aspect of [16/9,3/4]){
    const c=fixture(side,aspect);c.fixedMouthTestingTarget=()=>true;
    c.feed(c.pose());assert.equal(c.mouthTargetCalibration.locked,true);
    const fixed={...c.mouthTargetCalibration.target};
    const shifted=c.pose(.58,.24);c.feed(shifted,30);
    assert.deepEqual({...c.getEffectiveTargetXY(c.step)},fixed);
    shifted[side==='left'?19:20]={...fixed,visibility:1};c.feed(shifted,20);
    assert.deepEqual({...c.targetCanvasPoint(c.step,c.getEffectiveTargetXY(c.step))},fixed);
    assert.equal(c.checkTarget(shifted),true,'Hit testing uses the same fixed point');
    shifted[side==='left'?19:20]={x:.58,y:.24,visibility:1};
    assert.equal(c.checkTarget(shifted),false,'New lip position cannot move the activation point');
  }
});
