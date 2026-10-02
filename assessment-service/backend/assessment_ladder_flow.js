// Shared camera runner adapter. All entry points are inert without ladder=1.
function functionLadderRequested(){return URL_PARAMS.get('ladder')==='1';}
function fixedMouthTestingTarget(){return LOCAL_PREVIEW_MODE && functionLadderRequested() && tasks[currentTaskIdx]?.id==='T3';}
function functionLadderTask(){return functionLadderRequested() && !!RehynAssessmentLadder.TASKS[tasks[currentTaskIdx]?.id];}
const ladderFlow={engine:null,taskId:null,step:null,busy:false,waiting:false,returning:false,stretch:false,
  helper:URL_PARAMS.get('helper')==='1'?true:URL_PARAMS.get('helper')==='0'?false:null,
  otherHandMs:0,lastFrame:null,returnStarted:0,cycle:null,rest:null,effort:null,pain:null,handStage:null,handTargets:null,lastReach:null};
const ladderConfig=RehynAssessmentLadder.CONFIG;
const ladderHandFramingCopy='Please move a little farther from the camera. Keep your face, shoulders and lap in view.';
function functionLadderActive(){return functionLadderTask() && ladderFlow.taskId===tasks[currentTaskIdx]?.id && !!ladderFlow.engine;}
function ladderChoice(title,copy,choices){
  ladderFlow.waiting=true;voiceFinishedAt=0;inTargetSince=null;
  assessmentQuality.pauseEvidence?.();
  const panel=document.getElementById('ladderChoice');panel.hidden=false;
  document.getElementById('ladderChoiceTitle').textContent=title;
  document.getElementById('ladderChoiceCopy').textContent=copy;
  const actions=document.getElementById('ladderChoiceActions');actions.replaceChildren();
  return new Promise(resolve=>{for(const [label,value] of choices){const button=document.createElement('button');button.type='button';button.textContent=label;
    button.onclick=()=>{panel.hidden=true;ladderFlow.waiting=false;resolve(value);};actions.append(button);}
    document.getElementById('ladderChoiceTitle').focus();});
}
async function askFunctionLadderHelper(){
  ladderFlow.helper=await ladderChoice('Is someone with you right now?','We will ask before using help. You can support your forearm for hand tasks without it counting as help with the movement.',[
    ['Yes, someone is here',true],['No, I am on my own',false]]);
}
function ladderStartRung(taskId){
  const raw=URL_PARAMS.get('start_rung');try{const parsed=JSON.parse(raw);return parsed && typeof parsed==='object'?parsed[taskId]:undefined;}catch{return taskId==='T1'?raw:undefined;}
}
function ladderPosture(){
  const evidence=assessmentQuality.snapshot().compensations;
  return Object.fromEntries(RehynAssessmentLadder.TASKS[ladderFlow.taskId].checks.map(id=>{
    const c=evidence[id],hold=ladderConfig.minMeasuredMs;
    return [id,c?.max_streak_ms>=hold?'detected':c?.eligible_ms>=hold?'not_detected':'not_measured'];
  }));
}
function ladderSaveAttemptDiagnostics(){
  const attempt=ladderFlow.engine.attempts.at(-1);if(!attempt)return;
  attempt.quality=assessmentQuality.snapshot();attempt.angles_from_rest={};
  for(const name of ['arm_elevation','elbow_extension','wrist_bend']){
    const samples=(assessmentQuality.baselines || []).map(row=>row[name]).filter(Number.isFinite).sort((a,b)=>a-b);
    const current=attempt.quality.measurements?.[name]?.value;
    if(samples.length && Number.isFinite(current))attempt.angles_from_rest[name]=current-samples[Math.floor(samples.length/2)];
  }
}
function ladderEvidenceResult(snapshot){
  const attempts=snapshot.attempts;
  return {task_id:ladderFlow.taskId,completed_steps:attempts.filter(a=>a.completed).length,total_steps:attempts.length,
    duration_ms:snapshot.active_ms||0,steps:attempts.map((a,i)=>({step_id:`${ladderFlow.taskId}-R${i+1}`,completed:a.completed,duration_ms:a.duration_ms,metrics:{rung:a.rung,assist:a.assist,quality:a.quality || {}}})),
    metrics:{ladder:snapshot,effort:ladderFlow.effort,pain:ladderFlow.pain,clinical_measure:false}};
}
function ladderVisibleCenter(height=.5){
  const view=stage.getBoundingClientRect(),frame=cameraFrame.getBoundingClientRect();
  if(![view.left,view.top,frame.left,frame.top,view.width,view.height,frame.width,frame.height].every(Number.isFinite)
    || frame.width<=0 || frame.height<=0)return {x:.5,y:height};
  return {x:1-(view.left+view.width*.5-frame.left)/frame.width,
    y:(view.top+view.height*height-frame.top)/frame.height};
}
function ladderArmTargetRadius(landmarks){
  return Math.min(Math.max(.11,shoulderWidth(landmarks)*.70),.18);
}
function captureLadderHandOpeningTarget(landmarks){
  const targets=ladderFlow.handTargets;
  if(targets.opening || !landmarks || performance.now()-lastPoseScanTs>ladderConfig.maxFrameGapMs)return;
  const left=landmarks[11],right=landmarks[12],lap=assessmentLapTarget;
  if(!landmarkIsUsable(left,ladderConfig.poseConfidence) || !landmarkIsUsable(right,ladderConfig.poseConfidence)
    || !lap || ![lap.x,lap.y].every(Number.isFinite))return;
  const shoulders=midpoint(left,right),affected=AFFECTED_SIDE==='left'?left:right;
  const aspect=video.videoWidth/video.videoHeight||1;
  const radius=ladderArmTargetRadius(landmarks);
  const radiusX=radius/Math.max(aspect,1),radiusY=radius/Math.max(1/aspect,1);
  // Put the palm below the face, leaving room above the ring for upright fingers.
  // Capture before initialization and keep this same size and position through
  // raising, palm orientation, opening and retries.
  const faceBottom=Math.max(shoulders.y-shoulderWidth(landmarks)*.5*aspect,
    ...[0,9,10].map(index=>landmarks[index]).filter(p=>landmarkIsUsable(p,ladderConfig.poseConfidence)).map(p=>p.y));
  const fingerSpace=shoulderWidth(landmarks)*.5*aspect;
  // Ring and fingers extend from the same palm center; avoid counting their
  // clearance twice and placing the enlarged circle back down on the lap.
  const y=Math.max(shoulders.y+Math.max(0,lap.y-shoulders.y)*.35,faceBottom+Math.max(radiusY,fingerSpace)+.035);
  const view=stage.getBoundingClientRect(),frame=cameraFrame.getBoundingClientRect();
  if(![view.left,view.top,view.width,view.height,frame.left,frame.top,frame.width,frame.height].every(Number.isFinite)
    || frame.width<=0 || frame.height<=0)return;
  const minX=Math.max(0,1-(view.left+view.width-frame.left)/frame.width)+radiusX*1.08;
  const maxX=Math.min(1,1-(view.left-frame.left)/frame.width)-radiusX*1.08;
  const minY=Math.max(0,(view.top-frame.top)/frame.height)+radiusY*1.08;
  const maxY=Math.min(1,(view.top+view.height-frame.top)/frame.height)-radiusY*1.08;
  if(minX>maxX || y<minY || y>maxY)return; // Do not push a cropped target back into the face.
  targets.opening={x:Math.min(maxX,Math.max(minX,(shoulders.x+affected.x)/2)),y};
  targets.initial={...targets.opening};targets.initialRadius=targets.openingRadius=radius;
  if(['initial','palm'].includes(ladderFlow.handStage) && ladderFlow.step?.id===`${ladderFlow.taskId}-position-${ladderFlow.handStage}`){
    Object.assign(ladderFlow.step,{ladderTarget:{...targets.opening},ladderTargetPending:false,ladderRadius:radius});
    ladderFlow.step.target.r=radius;
  }
}
async function startFunctionLadderTask(){
  const task=tasks[currentTaskIdx];
  if(task.id==='T3') mouthTargetCalibration = newMouthTargetCalibration();
  Object.assign(ladderFlow,{taskId:task.id,engine:new RehynAssessmentLadder.Ladder({taskId:task.id,startRung:ladderStartRung(task.id),helper:ladderFlow.helper,fixedRung:fixedMouthTestingTarget()?'mouth':null}),
    returning:false,stretch:false,busy:false,otherHandMs:0,otherHandSuspected:false,lastFrame:null,effort:null,pain:null,handStage:null,handTargets:null,lastReach:null,rest:assessmentLapTarget && {...assessmentLapTarget}});
  document.body.classList.add('function-ladder');
  prefetchVoice(taskCelebrationCopy().voice);
  prefetchVoice('Keep your affected hand resting on your lap for a moment.');
  if(tasks.some(row=>['T3','H4','H3'].includes(row.id)))prefetchVoice('Raise your affected hand to the starting circle and hold it there.');
  if(tasks.some(row=>row.id==='T3'))prefetchVoice('From the starting circle, bring your hand to your mouth and hold. Keep your head comfortably still.');
  if(tasks.some(row=>row.id==='H4'))prefetchVoice('Keep your hand at the same circle. Turn your palm to face the camera and hold it there.');
  beginTaskRecording(task.id);startLocalReview(task.id);renderDots();
  if(task.id==='H4' || task.id==='T3'){
    const lm=latestPoseLandmarks;
    // H4 uses one face-clearing circle; T3 keeps its middle starting circle.
    const initialRadius=ladderArmTargetRadius(lm);
    ladderFlow.handTargets={initial:task.id==='H4'?null:ladderVisibleCenter(),initialRadius,
      ...(task.id==='H4'?{opening:null,openingRadius:initialRadius}:{mouth:null,mouthRadius:.12})};
    prefetchVoice(task.id==='T3'?'From the starting circle, bring your hand to your mouth and hold. Keep your head comfortably still.'
      :'Keep your hand at the same circle. Turn your palm to face the camera and hold it there.');
    prefetchVoice('Keep your palm facing the camera at the same circle. Open your fingers wide and hold.');
    prefetchVoice('Keep your palm facing the camera at the same circle. Open your fingers as far as is comfortable and hold.');
    prefetchVoice('Let your hand rest back on your lap.');
    return startLadderHandPosition('initial');
  }
  if(task.id==='H3'){
    const opening=taskResults.find(row=>row?.task_id==='H4')?.metrics?.ladder;
    if(opening && !opening.best_alone){
      const snapshot=opening.measured?RehynAssessmentLadder.Ladder.gatedPinch():{...ladderFlow.engine.snapshot(),stopped_by:'prerequisite_unmeasured'};
      taskResults[currentTaskIdx]=ladderEvidenceResult(snapshot);ladderFlow.engine.finish(snapshot.stopped_by);
      await ladderSay(opening.measured?'We will start with hand opening before trying pinch.':'We could not measure hand opening, so we will leave pinch unmeasured today.');
      return advanceFunctionLadderTask();
    }
    // Place the pinch circle centrally, slightly above halfway up the visible
    // camera area. Never anchor it to a palm that may still be resting on lap.
    ladderFlow.handTargets={initial:ladderVisibleCenter(),initialRadius:ladderArmTargetRadius(latestPoseLandmarks),
      pinch:ladderVisibleCenter(.43),pinchRadius:.12};
    prefetchVoice('Let your hand rest back on your lap.');
    return startLadderHandPosition('initial');
  }
  await prepareFunctionLadderAttempt();
}
function ladderHandPositioning(){return ['H4','T3','H3'].includes(ladderFlow.taskId) && ['initial','mouth','palm'].includes(ladderFlow.handStage);}
function captureLadderHandMouth(){
  if(ladderFlow.handTargets.mouth || !mouthTargetCalibration.locked || !mouthTargetCalibration.target)return;
  ladderFlow.handTargets.mouth={...mouthTargetCalibration.target};
  if(ladderFlow.handStage==='mouth'){
    ladderFlow.step.ladderTarget={...ladderFlow.handTargets.mouth};
    ladderFlow.step.ladderTargetPending=false;
  }
}
async function startLadderHandPosition(stage){
  ladderFlow.handStage=stage;
  if(stage==='mouth')captureLadderHandMouth();
  if(ladderFlow.taskId==='H4')captureLadderHandOpeningTarget(latestPoseLandmarks);
  const target=stage==='initial'?ladderFlow.handTargets.initial:stage==='palm'?ladderFlow.handTargets.opening:ladderFlow.handTargets.mouth;
  const voice=stage==='initial'?'Raise your affected hand to the starting circle and hold it there.'
    :'Keep your hand at the same circle. Turn your palm to face the camera and hold it there.';
  const radius=stage==='initial'?ladderFlow.handTargets.initialRadius:stage==='palm'?ladderFlow.handTargets.openingRadius:ladderFlow.handTargets.mouthRadius;
  ladderFlow.step={id:`${ladderFlow.taskId}-position-${stage}`,target:{landmark:stage==='mouth'?'MOUTH':stage==='palm'?'HAND_OPEN':'WRIST',r:radius},
    ladderTarget:target && {...target},ladderTargetPending:!target,ladderTargetSpace:'camera',
    ladderRadius:radius,hold_ms:1000,movement_required:false,voice,caption:voice};
  stepCompleted=false;targetCompletion=null;inTargetSince=null;lastInTargetTs=0;arrivedAfterMovement=true;
  assessmentQuality.reset(null);markLocalReviewStep(ladderFlow.step.id);
  document.getElementById('assessmentQualityStatus').textContent='';
  await ladderSay(voice);
}
function ladderHandTargetState(landmarks,now){
  const step=getCurrentStep(),target=getEffectiveTargetXY(step);
  const fresh=!!landmarks && now-lastPoseScanTs<=ladderConfig.maxFrameGapMs;
  const phaseActive=ladderHandPositioning() || ladderFlow.returning || ['attempt','retry'].includes(ladderFlow.engine.phase);
  const armed=phaseActive && fresh && !!target && !calibratingAssessment && !stepCompleted && !ladderFlow.busy && !ladderFlow.waiting
    && assessmentLapTargetLocked && voiceFinishedAt>0 && now-voiceFinishedAt>=ladderConfig.voiceSettleMs;
  if(!armed)return {armed:false,contact:false};
  const wrist=sideLandmarks(landmarks,AFFECTED_SIDE).wrist;
  const atWrist=ladderFlow.handStage==='initial' || ladderFlow.returning;
  const points=atWrist?(landmarkIsUsable(wrist,ladderConfig.poseConfidence)?[wrist]:[])
    :ladderFlow.taskId==='H4'?[rawHandPalmCenter()].filter(Boolean)
      :affectedMouthContactPoints(landmarks).filter(p=>p.visibility==null || landmarkIsUsable(p,ladderConfig.poseConfidence));
  const raw=targetCanvasPoint(step,target),radius=effectiveRadius(step,landmarks);
  const near=points.some(p=>RehynReachTarget.contains(RehynReachTarget.screenDistance(p,raw,video.videoWidth/video.videoHeight||1),radius));
  if(atWrist){
    const raised=ladderFlow.taskId!=='H4' || ladderFlow.handStage!=='initial'
      || landmarkIsUsable(wrist,ladderConfig.poseConfidence) && assessmentLapTarget
        && (assessmentLapTarget.y-wrist.y)*Math.max(video.videoHeight/video.videoWidth,1)>=ladderConfig.movementDistance;
    const lowered=!step.ladderReturnFrom || landmarkIsUsable(wrist,ladderConfig.poseConfidence)
      && (wrist.y-step.ladderReturnFrom.y)*Math.max(video.videoHeight/video.videoWidth,1)>=ladderConfig.movementDistance;
    return {armed,contact:near && raised && lowered};
  }
  const handFresh=!!latestHandLandmarks && now-latestHandSeenAt<=HAND_LANDMARK_FRESH_MS;
  if(!handFresh || !near)return {armed:handFresh,contact:false};
  const palmReady=palmFacingScore>PALM_FACING_THRESHOLD
    && palmProjectionEvidence(latestHandLandmarks).score>PALM_FACING_THRESHOLD;
  if(['mouth','palm'].includes(ladderFlow.handStage))return {armed,contact:palmReady};
  const contact=handOpenScore>=(ladderFlow.engine.rung==='partial'?ladderConfig.partialOpen:ladderConfig.fullOpen);
  return {armed,contact:palmReady && contact};
}
function makeLadderStep(){
  const task=tasks[currentTaskIdx],engine=ladderFlow.engine,rung=engine.rung;
  let template=task.steps.find(s=>s.id===`${task.id}-S2`);
  if(task.id==='T3' && rung==='chest')template=task.steps[0];
  const step={...template,target:{...template.target},movement_required:false};
  step.hold_ms=task.id==='H3'?template.hold_ms:ladderConfig.holdMs;
  if(task.id==='T1' && forwardReachPlacement?.ready && assessmentLapTarget){
    const base=forwardReachPlacement.raised,lap=mirrorX(assessmentLapTarget),height=RehynAssessmentLadder.TASKS.T1.heights[rung];
    step.ladderTarget=forwardReachPlacement.rungTargets?.[rung] || {x:base.x,y:lap.y+(base.y-lap.y)*height};
    step.ladderRadius=forwardReachPlacement.radius;
    if(ladderFlow.lastReach && height>RehynAssessmentLadder.TASKS.T1.heights[ladderFlow.lastReach.rung])
      step.ladderReachFrom={...ladderFlow.lastReach.wrist};
  }
  if(task.id==='H4'){
    step.ladderTarget={...ladderFlow.handTargets.opening};step.ladderTargetSpace='camera';
    step.ladderRadius=ladderFlow.handTargets.openingRadius;
  }else if(task.id==='T3' && rung==='chest'){
    step.ladderTarget={...ladderFlow.handTargets.initial};step.ladderTargetSpace='camera';
    step.ladderRadius=ladderFlow.handTargets.initialRadius;
  }else if(task.id==='H3'){
    step.ladderTarget={...ladderFlow.handTargets.pinch};step.ladderTargetSpace='camera';
    step.ladderRadius=ladderFlow.handTargets.pinchRadius;
  }
  step.voice=task.id==='T1'?'Reach the circle and hold your hand there for a moment.'
    :task.id==='T3'?rung==='mouth'?'From the starting circle, bring your hand to your mouth and hold. Keep your head comfortably still.':'Keep your hand at the starting circle and hold.'
    :task.id==='H4'?rung==='partial'?'Keep your palm facing the camera at the same circle. Open your fingers as far as is comfortable and hold.'
      :'Keep your palm facing the camera at the same circle. Open your fingers wide and hold.'
    :rung==='partial'?'Bring your thumb and index finger toward each other as far as is comfortable.':'Touch your thumb to your index finger and hold the pinch.';
  step.caption=step.voice;return step;
}
async function ladderSay(text){
  const engine=ladderFlow.engine;
  assessmentQuality.pauseEvidence?.();
  voiceFinishedAt=0;captionEl.textContent=text;setInstructionsOpen(true);document.body.classList.remove('step-active');document.body.classList.add('voice-playing');
  await playVoice(text);if(engine!==ladderFlow.engine || ladderFlow.waiting || ladderFlow.pain==='yes')return;
  document.body.classList.remove('voice-playing');document.body.classList.add('step-active');voiceFinishedAt=performance.now();
  setInstructionsOpen(!VOICE_GUIDANCE_ENABLED || voiceText.classList.contains('voiceRetry'));
}
async function prepareFunctionLadderAttempt(){
  const engine=ladderFlow.engine;
  if(['H4','T3','H3'].includes(ladderFlow.taskId))ladderFlow.handStage='gesture';
  ladderFlow.step=makeLadderStep();ladderFlow.cycle=new RehynAssessmentLadder.HandCycle();ladderFlow.otherHandMs=0;ladderFlow.otherHandSuspected=false;
  stepCompleted=false;targetCompletion=null;inTargetSince=null;lastInTargetTs=0;stepStartTime=performance.now();arrivedAfterMovement=true;
  const step=ladderFlow.step;markLocalReviewStep(step.id);
  assessmentQuality.reset(window.REHYN_ASSESSMENT_RUBRIC.tasks[ladderFlow.taskId]?.steps.find(s=>s.id===step.id));
  document.getElementById('assessmentQualityStatus').textContent='';
  prefetchVoice('You are doing well to keep trying. If comfortable, try once more.');
  await ladderSay(step.voice);if(engine===ladderFlow.engine)engine.cueDone();
}
function ladderContact(landmarks,now){
  if(!functionLadderActive() || ladderFlow.busy || ladderFlow.waiting || calibratingAssessment || stepCompleted || voiceFinishedAt===0 || now-voiceFinishedAt<ladderConfig.voiceSettleMs)return false;
  if(!lockAssessmentLapTargetAtMovement(now))return false;
  if(ladderFlow.taskId==='H4' || ladderHandPositioning())return ladderHandTargetState(landmarks,now).contact;
  if(!ladderFlow.returning && !ladderFlow.stretch && !['attempt','retry'].includes(ladderFlow.engine.phase))return false;
  const step=getCurrentStep();
  if(ladderFlow.taskId==='T1' && !ladderReachMovementPassed(landmarks,step))return false;
  if(ladderFlow.taskId==='T1' || ladderFlow.taskId==='T3' || ladderFlow.returning || ladderFlow.stretch)
    return !!landmarks && now-lastPoseScanTs<=ladderConfig.maxFrameGapMs && checkTarget(landmarks);
  if(!latestHandLandmarks || now-latestHandSeenAt>HAND_LANDMARK_FRESH_MS)return false;
  const near=RehynReachTarget.contains(RehynReachTarget.screenDistance(rawHandPalmCenter(),targetCanvasPoint(step,getEffectiveTargetXY(step)),
    video.videoWidth/video.videoHeight||1),effectiveRadius(step,landmarks));
  if(!near)return false;
  if(ladderFlow.taskId==='H3')return pinchScore>=(ladderFlow.engine.rung==='full'?ladderConfig.fullPinch:ladderConfig.partialGesture);
  if(ladderFlow.engine.rung==='partial')return Math.max(handOpenScore,fistClosureScore)>=ladderConfig.partialGesture;
  return ladderFlow.cycle.observe({open:handOpenScore,closed:fistClosureScore,valid:true});
}
function ladderReachMovementPassed(landmarks,step=getCurrentStep()){
  if(!step?.ladderReachFrom)return true;
  const wrist=landmarks && sideLandmarks(landmarks,AFFECTED_SIDE).wrist;
  return landmarkIsUsable(wrist,ladderConfig.poseConfidence)
    && (step.ladderReachFrom.y-wrist.y)*Math.max(video.videoHeight/video.videoWidth,1)>=ladderConfig.movementDistance;
}
function rememberLadderReach(landmarks){
  if(!functionLadderActive() || ladderFlow.taskId!=='T1' || ladderFlow.returning)return;
  const wrist=landmarks && sideLandmarks(landmarks,AFFECTED_SIDE).wrist;
  if(landmarkIsUsable(wrist,ladderConfig.poseConfidence))ladderFlow.lastReach={rung:ladderFlow.engine.rung,wrist:{x:wrist.x,y:wrist.y}};
}
function ladderFrame(landmarks,now){
  if(!functionLadderActive() || calibratingAssessment)return;
  if(voiceFinishedAt>0 && now-voiceFinishedAt>=ladderConfig.voiceSettleMs && !lockAssessmentLapTargetAtMovement(now))return;
  const engine=ladderFlow.engine,step=getCurrentStep();
  if(ladderHandPositioning()){
    if(ladderFlow.taskId==='H4'){
      captureLadderHandOpeningTarget(landmarks);
      if(step.ladderTargetPending){captionEl.textContent=ladderHandFramingCopy;setInstructionsOpen(true);}
      else if(captionEl.textContent===ladderHandFramingCopy){captionEl.textContent=step.caption;setInstructionsOpen(!VOICE_GUIDANCE_ENABLED || voiceText.classList.contains('voiceRetry'));}
    }
    if(ladderFlow.taskId==='T3' && landmarks && now-lastPoseScanTs<=ladderConfig.maxFrameGapMs && (ladderFlow.handStage==='initial' || !ladderFlow.handTargets.mouth)){
      updateMouthTargetCalibration(landmarks,lastPoseScanTs);
      if(ladderFlow.handStage==='mouth')captureLadderHandMouth();
    }
    // Positioning is preparation, never evidence of finger function.
    if(!ladderFlow.busy && !ladderFlow.waiting && !stepCompleted && voiceFinishedAt>0 && now-voiceFinishedAt>=20000)
      void finishFunctionLadderAttempt(false);
    return;
  }
  if(ladderFlow.returning || ladderFlow.stretch){
    if(!ladderFlow.busy && !ladderFlow.waiting && voiceFinishedAt>0 && now-voiceFinishedAt>=ladderConfig.returnMs)void finishFunctionLadderAttempt(false);
    return;
  }
  const point=landmarks && sideLandmarks(landmarks,AFFECTED_SIDE).wrist;
  const handTask=ladderFlow.taskId.startsWith('H');
  const valid=handTask?!!latestHandLandmarks && now-latestHandSeenAt<=HAND_LANDMARK_FRESH_MS:landmarkIsUsable(point,ladderConfig.poseConfidence) && now-lastPoseScanTs<=ladderConfig.maxFrameGapMs;
  const target=getEffectiveTargetXY(step),raw=target && targetCanvasPoint(step,target);
  const distance=valid?RehynReachTarget.screenDistance(point,raw,video.videoWidth/video.videoHeight||1):Infinity;
  const movementPoint=handTask?latestHandLandmarks?.[0]:point;
  const moved=valid && movementPoint && ladderFlow.rest && RehynReachTarget.screenDistance(movementPoint,ladderFlow.rest,video.videoWidth/video.videoHeight||1)>=ladderConfig.movementDistance;
  const paused=ladderFlow.waiting || ladderFlow.busy || voiceFinishedAt===0 || stepCompleted;
  const other=landmarks && sideLandmarks(landmarks,AFFECTED_SIDE==='left'?'right':'left').wrist;
  const dt=ladderFlow.lastFrame===null?0:Math.min(ladderConfig.maxFrameGapMs,now-ladderFlow.lastFrame);ladderFlow.lastFrame=now;
  if(!handTask && !paused && valid && landmarkIsUsable(other,ladderConfig.poseConfidence) && RehynReachTarget.screenDistance(point,other,video.videoWidth/video.videoHeight||1)<ladderConfig.otherHandNear)ladderFlow.otherHandMs+=dt;
  else ladderFlow.otherHandMs=0;
  if(ladderFlow.otherHandMs>=ladderConfig.otherHandMs)ladderFlow.otherHandSuspected=true;
  const before=engine.attempts.length;
  const event=engine.tick({now,valid,paused,distance,movement:!!moved,compensations:valid?ladderPosture():{}});
  if(engine.attempts.length>before)ladderSaveAttemptDiagnostics();
  if(event)void handleLadderEvent(event);
}
async function handleLadderEvent(event){
  if(ladderFlow.busy)return;
  ladderFlow.busy=true;inTargetSince=null;stepCompleted=false;
  try{
    if(event==='cue')await prepareFunctionLadderAttempt();
    else if(event==='encourage'){await ladderSay('You are doing well to keep trying. If comfortable, try once more.');ladderFlow.engine.cueDone();}
    else if(event==='movement_cue'){await ladderSay('Move your hand as far as is comfortable. Every movement counts.');ladderFlow.engine.cueDone();}
    else if(event==='support_offer'){
      const accepted=await ladderChoice('Would you like to try with help?',ladderFlow.helper?'Ask the person with you to support the movement, only if it is comfortable. Do not pull or force your arm.'
        :'Hold your wrist with your other hand and lift together, only if it is comfortable. For finger tasks, help the fingers move gently. Supporting the forearm alone does not count as help.',[['Try with help',true],['Move on',false]]);
      const next=ladderFlow.engine.offerHelp(accepted);ladderFlow.busy=false;return handleLadderEvent(next);
    }else if(event==='done'){ladderFlow.busy=false;return finishFunctionLadderTask();}
  }finally{ladderFlow.busy=false;}
}
async function finishFunctionLadderAttempt(completed){
  if(!functionLadderActive() || ladderFlow.busy || ladderFlow.waiting)return;
  if(ladderHandPositioning()){
    ladderFlow.busy=true;
    try{
      if(!completed){ladderFlow.engine.finish('position_not_reached');return await returnAfterFunctionLadder();}
      if(ladderFlow.handStage==='initial')return ladderFlow.taskId==='H4'
        ? await startLadderHandPosition('palm') : await prepareFunctionLadderAttempt();
      if(!(ladderFlow.taskId==='H4'?ladderFlow.handTargets.opening:ladderFlow.handTargets.mouth))return;
      return await prepareFunctionLadderAttempt();
    }finally{ladderFlow.busy=false;}
  }
  if(ladderFlow.returning){ladderFlow.returning=false;return completeFunctionLadderTask();}
  if(ladderFlow.stretch){ladderFlow.engine.stretchCompleted=completed;ladderFlow.stretch=false;return returnAfterFunctionLadder();}
  ladderFlow.busy=true;
  let assist=ladderFlow.engine.assist;
  if(completed && !assist && ladderFlow.otherHandSuspected && !ladderFlow.taskId.startsWith('H')){
    const helped=await ladderChoice('Did your other hand help?','Please tell us whether your other hand helped lift the affected arm.',[['Yes, it helped',true],['No, I moved on my own',false]]);
    if(helped)assist='self';
  }
  Object.assign(ladderFlow.engine.checks,ladderPosture());
  const event=ladderFlow.engine.complete(completed,{assist});
  if(ladderFlow.engine.attempts.length)ladderSaveAttemptDiagnostics();
  ladderFlow.busy=false;return handleLadderEvent(event);
}
async function finishFunctionLadderTask(){
  // The 160% rung is already the highest reach; do not add a fourth stretch.
  return returnAfterFunctionLadder();
}
async function returnAfterFunctionLadder(){
  if(ladderFlow.pain==='yes')return completeFunctionLadderTask();
  ladderFlow.returning=true;ladderFlow.step={...tasks[currentTaskIdx].steps.find(isLapTarget),movement_required:false};
  if(ladderFlow.taskId==='H4'){
    ladderFlow.handStage='lap';
    const wrist=latestPoseLandmarks && sideLandmarks(latestPoseLandmarks,AFFECTED_SIDE).wrist;
    // A lower opening circle can put the wrist within the lap radius already.
    // Still require a fresh lowering movement before the lap hold can finish.
    if(landmarkIsUsable(wrist,ladderConfig.poseConfidence))ladderFlow.step.ladderReturnFrom={x:wrist.x,y:wrist.y};
  }
  stepCompleted=false;inTargetSince=null;targetCompletion=null;arrivedAfterMovement=true;
  await ladderSay('Let your hand rest back on your lap.');
}
async function completeFunctionLadderTask(){
  // Stay in the calibrated position: no after-task touch questions. Unanswered
  // effort/pain remain null rather than being recorded as "easy" or "no pain".
  stepCompleted=true;
  taskResults[currentTaskIdx]=ladderEvidenceResult(ladderFlow.engine.snapshot());
  return advanceFunctionLadderTask(ladderFlow.pain==='yes');
}
async function advanceFunctionLadderTask(stop=false){
  const completed=taskResults.filter(row=>row?.metrics?.ladder && row.task_id!=='H3');
  if(!stop && completed.length===2 && completed.every(row=>row.metrics.ladder.measured && !row.metrics.ladder.movement_seen)){
    stop=await ladderChoice('Would you like to stop here?','We can finish today and start with supported movement and your carer.',[['Finish for today',true],['Continue',false]]);
  }
  stepCompleted=true;
  if(stop){
    for(let index=currentTaskIdx+1;index<tasks.length;index++){
      const tid=tasks[index].id,engine=RehynAssessmentLadder.TASKS[tid]?new RehynAssessmentLadder.Ladder({taskId:tid}):null;
      if(engine)engine.stop(ladderFlow.pain==='yes'?'pain_stop':'session_stopped');
      taskResults[index]={task_id:tid,total_steps:0,completed_steps:0,duration_ms:0,steps:[],metrics:{clinical_measure:false,measured:false,
        ...(engine?{ladder:engine.snapshot(),caregiver_delivered_plan:true}:{walking_skipped:true})}};
    }
  }
  ladderFlow.taskId=null;
  return celebrateAndAdvance({finish:stop});
}
