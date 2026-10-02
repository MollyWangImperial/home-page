const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const ladder=require('../assessment_ladder.js');
const runnerSource=fs.readFileSync(require.resolve('../server.py'),'utf8');
const celebrationCopy=runnerSource.slice(runnerSource.indexOf('function taskCelebrationCopy('),runnerSource.indexOf('\nconst AXONAI_MARKER_STORE_URL'));
const celebrationFlow=runnerSource.slice(runnerSource.indexOf('let taskTransitionPending='),runnerSource.indexOf('\nlet completionScreen ='));
function classList(){const values=new Set();return {add(...items){items.forEach(item=>values.add(item));},remove(...items){items.forEach(item=>values.delete(item));},contains:item=>values.has(item)};}
function fixture(taskId,query='ladder=1&helper=0'){
  const nodes={};const node=id=>nodes[id] ||= {hidden:false,textContent:'',style:{},classList:classList(),replaceChildren(){},append(){},focus(){}};
  const lap={id:`${taskId}-S4`,target:{landmark:'LAP_DYNAMIC',x:.5,y:.8},hold_ms:1200};
  const task={id:taskId,steps:[{id:`${taskId}-S1`,target:{landmark:'CHEST',x:.5,y:.4},hold_ms:1000},{id:`${taskId}-S2`,target:{landmark:taskId==='T3'?'MOUTH':'WRIST',x:.5,y:.3},hold_ms:1800},lap]};
  const c={URL_PARAMS:new URLSearchParams(query),RehynAssessmentLadder:ladder,RehynReachTarget:require('../reach_target.js'),
    tasks:[task],currentTaskIdx:0,currentStepIdx:0,taskResults:[],AFFECTED_SIDE:'right',ASSESSMENT_PACKAGE:'initial',LOCAL_PREVIEW_MODE:false,
    document:{getElementById:node,createElement:()=>node(Math.random()),body:{classList:classList()}},window:{},
    VOICE_GUIDANCE_ENABLED:true,voiceText:{classList:{contains:()=>false}},
    performance:{now:()=>2000},video:{videoWidth:640,videoHeight:480},stepCompleted:false,voiceFinishedAt:1000,inTargetSince:null,
    latestHandSeenAt:2000,HAND_LANDMARK_FRESH_MS:350,latestHandLandmarks:Array.from({length:21},()=>({x:.5,y:.4})),
    lastPoseScanTs:2000,latestPoseLandmarks:null,calibratingAssessment:false,assessmentLapTargetLocked:true,assessmentLapTarget:{x:.5,y:.8},forwardReachPlacement:{ready:true,radius:.126,raised:{x:.7,y:.45}},
    captionEl:node('caption'),beginTaskRecording(){},startLocalReview(){},renderDots(){},markLocalReviewStep(){},setInstructionsOpen(){},prefetchVoice:text=>c.prefetched.push(text),
    playVoice:async text=>{c.spoken.push(text);},mirrorX:p=>({x:1-p.x,y:p.y}),isLapTarget:s=>s.target.landmark==='LAP_DYNAMIC',
    activeHandPoint:()=>({x:.5,y:.4}),rawHandPalmCenter:()=>c.latestHandLandmarks && c.midpoint(c.latestHandLandmarks[5],c.latestHandLandmarks[17]),lockAssessmentLapTargetAtMovement:()=>true,
    stage:{getBoundingClientRect:()=>({left:0,top:0,width:640,height:480})},cameraFrame:{getBoundingClientRect:()=>({left:0,top:0,width:640,height:480})},
    effectiveRadius:step=>step.ladderRadius || .1,forwardReachDistance:(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),
    midpoint:(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2}),shoulderWidth:lm=>lm?Math.abs(lm[11].x-lm[12].x):.18,
    affectedMouthContactPoints:lm=>lm?[lm[c.AFFECTED_SIDE==='left'?19:20]]:[],
    updateMouthTargetCalibration:()=>Object.assign(c.mouthTargetCalibration,{locked:true,target:{x:.47,y:.30}}),
    assessmentQuality:{config:{compensations:{trunk_lean:{},shoulder_hike:{},head_drop:{},wrist_bend:{}}},reset(){},snapshot:()=>({compensations:{}})},
    checkTarget:()=>true,handOpenScore:0,fistClosureScore:0,pinchScore:0,palmFacingScore:.9,PALM_FACING_THRESHOLD:.38,palmProjectionEvidence:()=>({score:.9}),
    stopAndSaveTaskRecording:id=>c.recordingsSaved.push(id),finishLocalReview:async()=>{},persistTaskProgress:id=>c.persisted.push(id),postRN:message=>c.messages.push(message),finishAssessment:async()=>{c.finished=true;},startStep:async()=>{},
    landmarkIsUsable:p=>!!p && p.visibility>=.65,sideLandmarks:(lm,side)=>({wrist:lm[side==='left'?15:16]}),
    audioEl:{pause(){}},nodes,prefetched:[],spoken:[],persisted:[],messages:[],recordingsSaved:[],transitions:[],
    newMouthTargetCalibration:()=>({samples:[],target:null,locked:false,lastSampleKey:null}),mouthTargetCalibration:{target:{x:.5,y:.6},locked:true},
    CELEBRATION_LINES:[{title:'Wonderful work!'}],celebrateEl:node('celebrate'),celebrateTitle:node('celebrateTitle'),celebrateMsg:node('celebrateMsg'),
    celebrateProgress:node('celebrateProgress'),
    renderCelebrateDots:()=>c.transitions.push({task:c.tasks[c.currentTaskIdx].id,title:c.celebrateTitle.textContent,completed:c.taskCelebrationCopy().completed,next:c.celebrateMsg.textContent}),
    navigator:{},testingMouthEnabled:()=>false,requestAnimationFrame:fn=>fn(),setTimeout:fn=>{fn();}};
  c.window.REHYN_ASSESSMENT_RUBRIC={tasks:{[taskId]:{steps:[]}}};
  c.getCurrentStep=()=>c.flow.step;c.getEffectiveTargetXY=s=>s.ladderTargetPending?null:s.ladderTarget || (c.isLapTarget(s)?c.assessmentLapTarget:s.target);
  c.targetCanvasPoint=(s,t)=>s.ladderTargetSpace==='camera' || c.isLapTarget(s)?t:{x:1-t.x,y:t.y};
  vm.createContext(c);vm.runInContext(celebrationCopy+'\n'+celebrationFlow+'\n'+fs.readFileSync(require.resolve('../assessment_ladder_flow.js'),'utf8')+'\nglobalThis.flow=ladderFlow;',c);
  c.answers=[];c.ladderChoice=async()=>c.answers.shift();return c;
}
function handPose(c){
  const pose=Array.from({length:33},()=>({x:.3,y:.8,visibility:1}));
  pose[0]={x:.5,y:.25,visibility:1};pose[9]={x:.475,y:.3,visibility:1};pose[10]={x:.525,y:.3,visibility:1};
  pose[11]={x:.35,y:.5,visibility:1};pose[12]={x:.65,y:.5,visibility:1};
  return pose;
}
function placePalm(c,target){c.latestHandLandmarks=Array.from({length:21},()=>({...target}));}
async function positionHand(c){
  c.latestPoseLandmarks=handPose(c);c.ladderFrame(c.latestPoseLandmarks,2000);
  await c.finishFunctionLadderAttempt(true);
  assert.equal(c.flow.handStage,'palm');
  await c.finishFunctionLadderAttempt(true);
  assert.equal(c.flow.handStage,'gesture');
}
async function positionMouth(c){
  assert.equal(c.flow.handStage,'initial');
  assert.equal(c.flow.engine.attempts.length,0);
  await c.finishFunctionLadderAttempt(true);
  assert.equal(c.flow.handStage,'gesture');
}
async function positionPinch(c){
  assert.equal(c.flow.handStage,'initial');
  assert.equal(c.flow.engine.attempts.length,0);
  await c.finishFunctionLadderAttempt(true);
  assert.equal(c.flow.handStage,'gesture');
}
test('adapter remains inert without the ladder flag',()=>{const c=fixture('T1','');assert.equal(c.functionLadderTask(),false);assert.equal(c.functionLadderActive(),false);});

test('hand-only initial or follow-up selections load the hand model before calibration',async()=>{
  const source=fs.readFileSync(require.resolve('../server.py'),'utf8');
  const body=source.split('async function setupTrackingModels(){')[1].split('\n}')[0];
  for(const id of ['H4','H3']){
    let handCalls=0;
    const c={ASSESSMENT_PACKAGE:'initial',tasks:[{id}],setupPose:async()=>{},setupHand:async()=>{handCalls++;},DrawingUtils:class{},ctx:{}};
    vm.createContext(c);await vm.runInContext('(async()=>{'+body+'})()',c);
    assert.equal(handCalls,1);
  }
});
test('reach uses the same interpolated target for drawing and contact and permits movement from rest',async()=>{
  for(const [rung,y] of [['r80',.52],['r120',.38],['r160',.24]]){
    const c=fixture('T1','ladder=1&helper=0&start_rung='+rung);await c.startFunctionLadderTask();
    assert.equal(c.flow.step.ladderTarget.x,.7);assert.ok(Math.abs(c.flow.step.ladderTarget.y-y)<1e-8);
    assert.equal(c.flow.step.ladderRadius,c.ladderArmTargetRadius(null));
    assert.equal(c.flow.step.hold_ms,1500);assert.equal(c.arrivedAfterMovement,true);assert.equal(c.flow.engine.phase,'attempt');
  }
});
test('the highest reach returns to lap without an extra stretch or tap',async()=>{
  const c=fixture('T1','ladder=1&helper=0&start_rung=r80');
  c.ladderChoice=async()=>{throw new Error('Only the three requested reach heights should be offered');};
  await c.startFunctionLadderTask();
  for(let i=0;i<3;i++){
    c.flow.engine.checks={trunk_lean:'not_detected',shoulder_hike:'not_detected'};
    c.ladderPosture=()=>c.flow.engine.checks;
    await c.finishFunctionLadderAttempt(true);
  }
  assert.equal(c.flow.returning,true);assert.equal(c.flow.stretch,false);
  assert.deepEqual(Array.from(c.flow.engine.attempts,a=>a.rung),['r80','r120','r160']);
});
test('T3 always initializes in the middle before its mouth or chest scoring attempt',async()=>{
  for(const rung of ['mouth','chest']){const c=fixture('T3','ladder=1&helper=0&start_rung='+encodeURIComponent(JSON.stringify({T3:rung})));await c.startFunctionLadderTask();
    assert.equal(c.mouthTargetCalibration.target,null,'A new T3 task cannot reuse an old mouth position');
    assert.equal(c.mouthTargetCalibration.locked,false);
    assert.equal(c.flow.step.target.landmark,'WRIST');assert.deepEqual({...c.flow.step.ladderTarget},{x:.5,y:.5});
    await positionMouth(c);
    assert.equal(c.flow.step.target.landmark,rung==='mouth'?'MOUTH':'CHEST');assert.equal(c.flow.step.hold_ms,1500);
    assert.equal(c.flow.engine.attempts.length,0);}
});
test('H4 accepts opening at the fixed chest circle, rejects a fist and stale hand frames',async()=>{
  const c=fixture('H4');await c.startFunctionLadderTask();await positionHand(c);c.voiceFinishedAt=1000;
  const p=c.latestPoseLandmarks;placePalm(c,c.flow.handTargets.opening);
  c.handOpenScore=.1;c.fistClosureScore=.8;assert.equal(c.ladderContact(p,2000),false);
  c.handOpenScore=.5;assert.equal(c.ladderContact(p,2000),false,'Insufficient opening cannot close the full target');
  c.handOpenScore=.3;
  c.flow.engine.index=0;assert.equal(c.ladderContact(p,2000),true,'Partial opening has a lower threshold');
  c.flow.engine.index=1;c.handOpenScore=.8;c.fistClosureScore=.1;assert.equal(c.ladderContact(p,2000),true,'Already-open hand does not need to close first');
  c.palmFacingScore=.1;assert.equal(c.ladderContact(p,2000),false,'Opening still requires a palm facing the camera');c.palmFacingScore=.9;
  c.flow.engine.phase='movement';assert.equal(c.ladderContact(p,2000),false);c.flow.engine.phase='attempt';
  c.latestHandSeenAt=0;assert.equal(c.ladderContact(p,2000),false);
});

test('H4 positions first, freezes the chest circle across gesture retries, and keeps the calibrated lap',async()=>{
  const c=fixture('H4');c.activeHandPoint=()=>null;await c.startFunctionLadderTask();c.voiceFinishedAt=1000;
  assert.equal(c.getEffectiveTargetXY(c.flow.step),null);assert.equal(c.flow.handStage,'initial');
  assert.equal(c.flow.engine.phase,'cue');assert.equal(c.flow.engine.attempts.length,0);
  c.activeHandPoint=()=>({x:.25,y:.7});c.handOpenScore=.8;
  assert.equal(c.ladderContact(null,2000),false);assert.equal(c.getEffectiveTargetXY(c.flow.step),null);
  await positionHand(c);const opening={...c.flow.step.ladderTarget},radius=c.flow.step.ladderRadius;
  assert.equal(opening.x,.575);assert.ok(opening.y>.6 && opening.y<.7);assert.equal(c.flow.engine.attempts.length,0);
  assert.deepEqual(opening,{...c.flow.handTargets.initial});assert.equal(radius,c.flow.handTargets.initialRadius);
  c.mouthTargetCalibration.target={x:.1,y:.9};c.activeHandPoint=()=>({x:.8,y:.2});
  c.latestPoseLandmarks[9].y=.4;c.latestPoseLandmarks[11].y=.6;
  c.ladderFrame(c.latestPoseLandmarks,2000);assert.deepEqual({...c.flow.step.ladderTarget},opening);
  await c.finishFunctionLadderAttempt(false);assert.equal(c.flow.engine.rung,'partial');
  assert.deepEqual({...c.flow.step.ladderTarget},opening);assert.equal(c.flow.step.ladderRadius,radius);
  await c.finishFunctionLadderAttempt(true);assert.equal(c.flow.returning,true);
  assert.deepEqual(c.getEffectiveTargetXY(c.flow.step),c.assessmentLapTarget);
  assert.equal(c.spoken.filter(t=>t.startsWith('Raise your affected hand')).length,1);
});
test('H3 full requires 0.8, partial accepts 0.5 and both reject stale landmarks',async()=>{
  const c=fixture('H3');await c.startFunctionLadderTask();await positionPinch(c);c.voiceFinishedAt=1000;c.pinchScore=.6;assert.equal(c.ladderContact(null,2000),false);
  c.pinchScore=.8;assert.equal(c.ladderContact(null,2000),true);
  c.flow.engine.index=0;c.pinchScore=.5;assert.equal(c.ladderContact(null,2000),true);
  c.latestHandSeenAt=0;assert.equal(c.ladderContact(null,2000),false);
});
test('pinch gate submits an assigned task, but unmeasured opening cannot invent a zero',async()=>{
  for(const measured of [true,false]){const c=fixture('H3');c.taskResults=[{task_id:'H4',metrics:{ladder:{measured,best_alone:null}}}];c.currentTaskIdx=1;c.tasks.unshift({id:'H4'});
    await c.startFunctionLadderTask();assert.equal(c.taskResults[1].task_id,'H3');assert.equal(c.taskResults[1].metrics.ladder.prerequisite_not_met,measured);
    assert.equal(c.finished,true);}
});
test('returning to lap or timing out advances without feedback taps or invented answers',async()=>{
  for(const lapReached of [true,false]){
    const c=fixture('T3');c.ladderChoice=async()=>{throw new Error('No after-task questions should interrupt the calibrated position');};
    await c.startFunctionLadderTask();await positionMouth(c);await c.finishFunctionLadderAttempt(true);
    assert.equal(c.flow.returning,true);
    await c.finishFunctionLadderAttempt(lapReached);
    const result=c.taskResults[0];assert.equal(result.metrics.effort,null);assert.equal(result.metrics.pain,null);
    assert.equal(result.metrics.ladder.best_alone,'mouth');assert.equal(result.completed_steps,1);assert.equal(c.finished,true);
    assert.equal(c.transitions[0].completed,'Hand to mouth check complete');
    assert.equal(c.transitions[0].next,'Your movement check is finished');
  }
});
test('completion stays visible through the voice, rest interval and fade before starting the next task',async()=>{
  const c=fixture('T3');c.tasks.push(fixture('H4').tasks[0]);
  let releaseVoice;const timers=[];let starts=0;
  await c.startFunctionLadderTask();await positionMouth(c);await c.finishFunctionLadderAttempt(true);
  c.playVoice=()=>new Promise(resolve=>{releaseVoice=resolve;});
  c.setTimeout=(fn,ms)=>timers.push({fn,ms});c.startStep=async()=>{starts++;};
  const done=c.finishFunctionLadderAttempt(true);
  // Flush the saving step; speech remains pending.
  await Promise.resolve();await Promise.resolve();
  assert.equal(c.celebrateEl.classList.contains('show'),true);
  assert.equal(c.celebrateTitle.textContent,'Wonderful work!');
  assert.ok(!runnerSource.includes('id="celebrateLabel"'),'No redundant completed-task subtitle');
  assert.equal(c.celebrateMsg.textContent,'Up next: Hand opening');
  assert.equal(c.currentTaskIdx,0);assert.equal(starts,0);assert.equal(timers.length,0);
  assert.equal(c.celebrateEl.classList.contains('counting-down'),false,'Countdown waits until the announcement finishes');
  assert.equal(c.stepCompleted,true);assert.equal(c.voiceFinishedAt,0);
  assert.equal(c.document.body.classList.contains('task-transition'),true);
  await c.celebrateAndAdvance(); // Duplicate callbacks cannot save or advance twice.
  releaseVoice();await Promise.resolve();await Promise.resolve();
  assert.equal(timers[0].ms,3000);assert.equal(c.currentTaskIdx,0);
  assert.equal(c.celebrateProgress.style.animationDuration,'3000ms');
  assert.equal(c.celebrateEl.classList.contains('counting-down'),true);
  timers.shift().fn();await Promise.resolve();await Promise.resolve();
  assert.equal(timers[0].ms,350);assert.equal(starts,0);
  timers.shift().fn();await done;
  assert.equal(starts,1);assert.equal(c.currentTaskIdx,1);
  assert.deepEqual(c.persisted,['T3']);assert.deepEqual(c.recordingsSaved,['T3']);
  assert.equal(c.messages.filter(message=>message.type==='task_complete').length,1);
  assert.equal(c.celebrateEl.classList.contains('hidden'),true);
  assert.equal(c.celebrateEl.classList.contains('counting-down'),false,'The next completion starts with an empty ring');
  assert.equal(c.document.body.classList.contains('task-transition'),false);
});

test('a long completion announcement still gets a full three-second countdown before advancing',async()=>{
  const c=fixture('T3');c.tasks.push(fixture('H4').tasks[0]);
  await c.startFunctionLadderTask();await positionMouth(c);await c.finishFunctionLadderAttempt(true);
  let now=2000,releaseVoice,starts=0;const timers=[];
  c.performance.now=()=>now;
  c.playVoice=()=>new Promise(resolve=>{releaseVoice=resolve;});
  c.setTimeout=(fn,ms)=>timers.push({fn,ms});c.startStep=async()=>{starts++;};
  const done=c.finishFunctionLadderAttempt(true);for(let i=0;i<8;i++)await Promise.resolve();
  now+=6000;assert.equal(timers.length,0);assert.equal(starts,0);
  releaseVoice();for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(timers[0].ms,3000,'Speech duration cannot shorten the visible ring fill');
  assert.equal(c.celebrateProgress.style.animationDuration,'3000ms');
  assert.equal(c.celebrateEl.classList.contains('counting-down'),true);
  timers.shift().fn();await Promise.resolve();await Promise.resolve();
  assert.equal(c.celebrateEl.classList.contains('counting-down'),true,'Keep the filled ring visible during the fade');
  assert.equal(timers[0].ms,350);assert.equal(starts,0);
  timers.shift().fn();await done;assert.equal(starts,1);
});

test('the final check fills the same ring before opening analysis, with no next-task announcement',async()=>{
  const c=fixture('T3');const timers=[];
  await c.startFunctionLadderTask();await positionMouth(c);await c.finishFunctionLadderAttempt(true);
  const instructionCount=c.spoken.length;
  c.setTimeout=(fn,ms)=>timers.push({fn,ms});
  const done=c.finishFunctionLadderAttempt(true);for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(c.spoken.length,instructionCount);assert.equal(c.finished,undefined);
  assert.equal(c.celebrateMsg.textContent,'Your movement check is finished');
  assert.equal(c.celebrateEl.classList.contains('counting-down'),true);
  assert.equal(timers[0].ms,3000);assert.equal(c.celebrateProgress.style.animationDuration,'3000ms');
  timers.shift().fn();await Promise.resolve();await Promise.resolve();
  assert.equal(c.finished,undefined);timers.shift().fn();await done;
  assert.equal(c.finished,true);assert.equal(c.celebrateEl.classList.contains('counting-down'),false);
});
test('finishing early celebrates the completed check without introducing an unattempted task',async()=>{
  const c=fixture('T1');c.tasks.push(fixture('T3').tasks[0]);
  await c.startFunctionLadderTask();c.taskResults[0]=c.ladderEvidenceResult(c.flow.engine.snapshot());
  await c.advanceFunctionLadderTask(true);
  assert.equal(c.finished,true);assert.equal(c.transitions.length,1);
  assert.equal(c.transitions[0].next,'Your movement check is finished');
  assert.equal(c.taskResults[1].metrics.ladder.measured,false);
  assert.deepEqual(c.persisted,['T1']);
});
test('gated pinch does not claim the patient performed it, and introduces walking',async()=>{
  const c=fixture('H3');c.tasks.unshift({id:'H4'});c.tasks.push({id:'L6'});c.currentTaskIdx=1;
  c.taskResults=[{task_id:'H4',metrics:{ladder:{measured:true,best_alone:null}}}];
  await c.startFunctionLadderTask();
  assert.equal(c.transitions[0].completed,'Thumb and finger pinch left for another day');
  assert.equal(c.transitions[0].next,'Up next: Walking');assert.equal(c.currentTaskIdx,2);
});
test('declining support returns to lap and then shows the same completion screen',async()=>{
  const c=fixture('H4','ladder=1&helper=0&start_rung='+encodeURIComponent(JSON.stringify({H4:'partial'})));
  await c.startFunctionLadderTask();await positionHand(c);await c.finishFunctionLadderAttempt(false);
  c.flow.engine.phase='support_offer';c.answers=[false];await c.handleLadderEvent('support_offer');
  assert.equal(c.flow.returning,true);assert.equal(c.transitions.length,0);
  await c.finishFunctionLadderAttempt(true);
  assert.equal(c.transitions[0].completed,'Hand opening check complete');assert.equal(c.finished,true);
});
test('missing wrist cannot turn hand visibility into movement evidence',async()=>{
  const c=fixture('H4');await c.startFunctionLadderTask();await positionHand(c);c.latestHandLandmarks=null;c.voiceFinishedAt=1000;
  c.ladderFrame(null,2000);c.ladderFrame(null,2100);assert.equal(c.flow.engine.snapshot().movement_seen,false);
});

test('other-hand confirmation requires sustained proximity, and remembers it after the hands separate',async()=>{
  const c=fixture('T1','ladder=1&helper=0&start_rung=r120');await c.startFunctionLadderTask();c.voiceFinishedAt=1000;
  const pose=Array.from({length:33},()=>({x:.5,y:.4,visibility:1}));
  let now=2000;
  const frame=near=>{now+=100;c.lastPoseScanTs=now;pose[15].x=near ? .5 : .9;c.ladderFrame(pose,now);};
  for(let repeat=0;repeat<3;repeat++){for(let i=0;i<4;i++)frame(true);frame(false);}
  assert.equal(c.flow.otherHandSuspected,false,'Separate brief contacts must not add into a sustained hold');
  for(let i=0;i<8;i++)frame(true);frame(false);
  assert.equal(c.flow.otherHandSuspected,true);
  c.answers=[true];await c.finishFunctionLadderAttempt(true);
  assert.equal(c.flow.engine.snapshot().attempts[0].assist,'self');
  assert.equal(c.flow.returning,true);
});

test('a four-task replay advances, returns to lap once and saves every ladder result',async()=>{
  const ids=['T1','T3','H4','H3'];
  const c=fixture('T1','ladder=1&helper=0&start_rung=r120');
  c.tasks=ids.map(id=>fixture(id).tasks[0]);
  c.window.REHYN_ASSESSMENT_RUBRIC.tasks=Object.fromEntries(ids.map(id=>[id,{steps:[]}]));
  c.startStep=()=>c.startFunctionLadderTask();c.ladderChoice=async()=>{throw new Error('Independent task sequence must not ask for feedback taps');};
  await c.startFunctionLadderTask();
  // Reach r120, try higher, then stop on the first reversal.
  await c.finishFunctionLadderAttempt(true);assert.equal(c.flow.engine.rung,'r160');
  await c.finishFunctionLadderAttempt(false);assert.equal(c.flow.returning,true);
  await c.finishFunctionLadderAttempt(true);assert.equal(c.tasks[c.currentTaskIdx].id,'T3');
  for(const id of ids.slice(1)){
    assert.equal(c.flow.taskId,id);
    if(id==='H4')await positionHand(c);
    if(id==='T3')await positionMouth(c);
    if(id==='H3')await positionPinch(c);
    await c.finishFunctionLadderAttempt(true);assert.equal(c.flow.returning,true);
    await c.finishFunctionLadderAttempt(true);
  }
  assert.equal(c.finished,true);assert.equal(c.taskResults.length,4);
  assert.deepEqual(Array.from(c.taskResults,row=>row.task_id),ids);
  assert.equal(c.taskResults[0].metrics.ladder.attempts.length,2);
  assert.deepEqual(c.transitions.map(item=>item.task),ids);
  assert.deepEqual(c.transitions.map(item=>item.next),['Up next: Hand to mouth','Up next: Hand opening','Up next: Thumb and finger pinch','Your movement check is finished']);
  assert.deepEqual(c.persisted,ids);assert.deepEqual(c.recordingsSaved,ids);
  assert.ok(c.prefetched.includes(c.taskCelebrationCopy(0).voice),'Completion speech is prefetched before it is needed');
  for(const row of c.taskResults){assert.equal(row.metrics.effort,null);assert.equal(row.metrics.pain,null);assert.equal(row.metrics.clinical_measure,false);}
  if(process.env.FUNCTION_REPLAY_OUTPUT)fs.writeFileSync(process.env.FUNCTION_REPLAY_OUTPUT,JSON.stringify(c.taskResults));
});

test('H4 preparation never scores finger movement and uses only the affected side after speech',async()=>{
  for(const side of ['left','right'])for(const aspect of [16/9,3/4]){
    const c=fixture('H4');c.AFFECTED_SIDE=side;c.video.videoWidth=480*aspect;
    const p=handPose(c);c.latestPoseLandmarks=p;await c.startFunctionLadderTask();
    const wi=side==='left'?15:16,other=side==='left'?16:15;
    const ready={...c.flow.step.ladderTarget};c.handOpenScore=.9;
    p[other]={...ready,visibility:1};c.voiceFinishedAt=1000;
    assert.equal(c.ladderContact(p,2000),false);
    p[wi]={...ready,visibility:1};assert.equal(c.ladderContact(p,2000),true);
    c.voiceFinishedAt=0;assert.equal(c.ladderContact(p,2000),false);c.voiceFinishedAt=1000;
    c.lastPoseScanTs=0;assert.equal(c.ladderContact(p,2000),false);c.lastPoseScanTs=2000;
    c.ladderFrame(p,2000);assert.equal(c.flow.engine.snapshot().measured,false);
    c.latestPoseLandmarks=p;
    await c.finishFunctionLadderAttempt(true);assert.equal(c.flow.handStage,'palm');
    c.voiceFinishedAt=1000;
    const opening={...c.flow.handTargets.opening};
    assert.deepEqual(opening,ready);assert.equal(c.flow.step.ladderRadius,c.flow.handTargets.initialRadius);
    assert.equal(opening.x,side==='left'?.425:.575);
    const radiusY=c.flow.step.ladderRadius/Math.max(1/aspect,1);
    assert.ok(opening.y-Math.max(radiusY,.3*.5*aspect)>.3,'Both the ring and upright fingers clear the face');
    placePalm(c,{x:.5,y:.3});
    p[wi]={...opening,visibility:1};
    assert.equal(c.ladderContact(p,2000),false,'Wrist inside the ring cannot hide a palm still held at the face');
    placePalm(c,opening);
    assert.equal(c.ladderContact(p,2000),true,'The palm reaches the lower circle');
    await c.finishFunctionLadderAttempt(true);
    assert.equal(c.flow.handStage,'gesture');assert.deepEqual({...c.flow.step.ladderTarget},opening);
    assert.equal(c.flow.engine.attempts.length,0);c.voiceFinishedAt=1000;
    assert.equal(c.ladderContact(p,2000),true);await c.finishFunctionLadderAttempt(true);
    assert.equal(c.flow.handStage,'lap');assert.equal(c.flow.engine.attempts.length,1);
    c.voiceFinishedAt=1000;p[wi]={...c.assessmentLapTarget,visibility:1};
    assert.equal(c.ladderContact(p,2000),true);await c.finishFunctionLadderAttempt(true);
    assert.equal(c.finished,true);assert.equal(c.taskResults[0].metrics.ladder.protocol,'hand_open_at_chest_v2');
    assert.equal(c.spoken[0],'Raise your affected hand to the starting circle and hold it there.');
    assert.match(c.spoken[1],/palm to face the camera/);
    assert.match(c.spoken[1],/Keep your hand at the same circle/);
    assert.ok(c.prefetched.includes(c.spoken[1]),'The new instruction is prefetched before playback');
    assert.ok(c.spoken.every(text=>!/mouth/i.test(text)),'Opening instructions must not sound like another hand-to-mouth task');
    assert.match(c.spoken[2],/Open your fingers/);assert.match(c.spoken[3],/rest back on your lap/);
  }
});

test('H4 never invents a chest target or finger score when body framing cannot place it',async()=>{
  const c=fixture('H4');await c.startFunctionLadderTask();
  const p=handPose(c);p[11].visibility=0;c.latestPoseLandmarks=p;
  await c.finishFunctionLadderAttempt(true);
  assert.equal(c.getEffectiveTargetXY(c.flow.step),null);c.voiceFinishedAt=1000;
  c.ladderFrame(p,21000);await Promise.resolve();await Promise.resolve();
  assert.equal(c.flow.returning,true);assert.equal(c.flow.engine.snapshot().measured,false);
  assert.equal(c.flow.engine.snapshot().stopped_by,'position_not_reached');
  assert.equal(c.flow.engine.attempts.length,0);
});

test('H4 waits for fresh shoulders and adequate framing before locking the whole large circle',async()=>{
  const c=fixture('H4');c.latestPoseLandmarks=handPose(c);c.lastPoseScanTs=0;
  c.stage.getBoundingClientRect=()=>({left:100,top:48,width:400,height:280});
  await c.startFunctionLadderTask();
  assert.equal(c.getEffectiveTargetXY(c.flow.step),null,'Stale shoulders cannot anchor the new circle');
  c.lastPoseScanTs=2000;c.ladderFrame(c.latestPoseLandmarks,2000);
  assert.equal(c.getEffectiveTargetXY(c.flow.step),null,'A cropped large circle must not be pushed into the face or silently shrunk');
  assert.match(c.captionEl.textContent,/farther from the camera.*face, shoulders and lap/);
  c.stage.getBoundingClientRect=()=>({left:100,top:48,width:400,height:360});
  c.ladderFrame(c.latestPoseLandmarks,2000);
  const target={...c.flow.step.ladderTarget},radius=c.flow.step.ladderRadius;
  assert.equal(c.captionEl.textContent,c.flow.step.caption,'Corrected framing restores the starting instruction');
  assert.equal(radius,.18);assert.ok(target.y+radius*1.08<=408/480);
  assert.ok(target.x-radius/Math.max(640/480,1)*1.08>=1-500/640);
  assert.ok(target.x+radius/Math.max(640/480,1)*1.08<=1-100/640);
  c.latestPoseLandmarks[0].y=.4;c.latestPoseLandmarks[11].y=.55;
  c.ladderFrame(c.latestPoseLandmarks,2000);assert.deepEqual({...c.flow.step.ladderTarget},target);
});

test('H4 lap return cannot finish from an unmoved wrist already inside the lap ring',async()=>{
  const c=fixture('H4');await c.startFunctionLadderTask();await positionHand(c);
  const p=c.latestPoseLandmarks;p[16]={x:.5,y:.735,visibility:1};
  await c.finishFunctionLadderAttempt(true);c.voiceFinishedAt=1000;
  assert.equal(c.flow.returning,true);assert.equal(c.ladderContact(p,2000),false);
  p[16]=null;assert.equal(c.ladderContact(p,2000),false,'Missing wrist evidence cannot finish the return');
  p[16]={x:.5,y:.8,visibility:1};assert.equal(c.ladderContact(p,2000),true,'Lowering to the original lap completes the return');
  assert.deepEqual(c.getEffectiveTargetXY(c.flow.step),c.assessmentLapTarget);
});

test('H4 keeps the large starting circle through orientation, opening and body noise',async()=>{
  const c=fixture('H4');c.latestPoseLandmarks=handPose(c);
  await c.startFunctionLadderTask();
  assert.equal(c.flow.step.ladderRadius,.18);
  const anchor={...c.flow.step.ladderTarget};
  c.latestPoseLandmarks[11].x=.46;c.latestPoseLandmarks[12].x=.54;
  c.ladderFrame(c.latestPoseLandmarks,2000);
  assert.equal(c.flow.step.ladderRadius,.18);
  assert.deepEqual({...c.flow.step.ladderTarget},anchor);
  await c.finishFunctionLadderAttempt(true);
  assert.deepEqual({...c.flow.step.ladderTarget},anchor);assert.equal(c.flow.step.ladderRadius,.18);
  await c.finishFunctionLadderAttempt(true);
  assert.deepEqual({...c.flow.step.ladderTarget},anchor);assert.equal(c.flow.step.ladderRadius,.18);
});

test('H4 initialization requires raising the affected wrist even if the lap lies inside the large circle',async()=>{
  const c=fixture('H4');c.latestPoseLandmarks=handPose(c);c.assessmentLapTarget={x:.575,y:.7};
  await c.startFunctionLadderTask();c.voiceFinishedAt=1000;
  const p=c.latestPoseLandmarks;p[16]={...c.assessmentLapTarget,visibility:1};
  assert.equal(c.ladderContact(p,2000),false,'A resting wrist cannot complete initialization');
  p[16].y-=.05;assert.equal(c.ladderContact(p,2000),true,'A fresh raise inside the same circle starts orientation');
});

test('local mouth test starts at the mouth and never drops to a chest attempt after failure',async()=>{
  const c=fixture('T3','ladder=1&helper=0&start_rung='+encodeURIComponent(JSON.stringify({T3:'chest'})));
  c.LOCAL_PREVIEW_MODE=true;await c.startFunctionLadderTask();await positionMouth(c);
  assert.equal(c.flow.engine.rung,'mouth');assert.equal(c.flow.step.target.landmark,'MOUTH');
  assert.equal(c.flow.engine.snapshot().fixed_target,true);
  const engine=c.flow.engine;engine.complete(false);
  assert.equal(engine.phase,'movement_cue');assert.equal(engine.rung,'mouth');
  assert.equal(c.flow.step.target.landmark,'MOUTH');
  engine.cueDone();for(let now=0;now<=5000;now+=100)engine.tick({now,valid:true});
  assert.equal(engine.phase,'support_offer');assert.equal(engine.offerHelp(true),'cue');
  await c.prepareFunctionLadderAttempt();
  assert.equal(engine.rung,'mouth');assert.equal(c.flow.step.target.landmark,'MOUTH');
  assert.equal(engine.assist,'self');
});

test('T3 initialization uses only the affected wrist, waits for speech and never scores function',async()=>{
  for(const side of ['left','right']){
    const c=fixture('T3');c.AFFECTED_SIDE=side;await c.startFunctionLadderTask();
    const p=handPose(c),wi=side==='left'?15:16,other=side==='left'?16:15;
    const initial={...c.flow.step.ladderTarget};c.voiceFinishedAt=1000;
    p[other]={...initial,visibility:1};assert.equal(c.ladderContact(p,2000),false);
    p[wi]={...initial,visibility:1};assert.equal(c.ladderContact(p,2000),true);
    c.voiceFinishedAt=0;assert.equal(c.ladderContact(p,2000),false);c.voiceFinishedAt=1000;
    c.lastPoseScanTs=0;assert.equal(c.ladderContact(p,2000),false);c.lastPoseScanTs=2000;
    c.ladderFrame(p,2000);assert.equal(c.flow.engine.snapshot().measured,false);
    assert.deepEqual({...c.flow.step.ladderTarget},initial);await positionMouth(c);
    assert.equal(c.flow.step.target.landmark,'MOUTH');assert.equal(c.flow.engine.attempts.length,0);
    assert.match(c.spoken[0],/starting circle/);assert.match(c.spoken[1],/From the starting circle.*mouth/);
  }
});

test('pinch remains fixed at the higher visible centre through hand motion and retries, including a cropped camera',async()=>{
  for(const crop of [false,true]){
    const c=fixture('H3');
    if(crop){
      c.stage.getBoundingClientRect=()=>({left:100,top:60,width:360,height:600});
      c.cameraFrame.getBoundingClientRect=()=>({left:-80,top:0,width:720,height:720});
    }
    await c.startFunctionLadderTask();await positionPinch(c);const target={...c.flow.step.ladderTarget};
    assert.equal(target.x,.5);assert.equal(target.y,crop?318/720:.43);
    c.rawHandPalmCenter=()=>target;c.voiceFinishedAt=1000;c.pinchScore=.9;
    assert.equal(c.ladderContact(null,2000),true);
    c.rawHandPalmCenter=()=>({x:.8,y:.8});assert.equal(c.ladderContact(null,2000),false);
    assert.deepEqual({...c.flow.step.ladderTarget},target);
    await c.finishFunctionLadderAttempt(false);assert.deepEqual({...c.flow.step.ladderTarget},target);
    assert.equal(c.flow.step.ladderRadius,.12);assert.equal(c.flow.step.ladderTargetSpace,'camera');
  }
});
