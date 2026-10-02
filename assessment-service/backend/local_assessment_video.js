// Explicit loopback preview only. Account recordings keep their own lifecycle.
const localReview={enabled:LOCAL_PREVIEW_MODE,session:null,active:null,results:{},error:null};
const localReviewStatus=document.createElement('div');
localReviewStatus.id='localRecordingStatus';localReviewStatus.setAttribute('role','status');
localReviewStatus.style.cssText='position:absolute;top:42px;left:16px;z-index:9;background:#102e27e8;color:#fff;padding:6px 10px;border-radius:8px;font:13px sans-serif;max-width:75%;pointer-events:none';
localReviewStatus.hidden=true;
if(localReview.enabled)document.getElementById('stage').append(localReviewStatus);
if(localReview.enabled && testingMouthEnabled()){
  localReviewStatus.style.cssText='position:static;margin:8px 0;color:#c4d8d0;font:13px sans-serif';
  document.getElementById('top').after(localReviewStatus);
}
function reviewStatus(text){if(!localReview.enabled)return;localReviewStatus.hidden=!text;localReviewStatus.textContent=text || '';}
function debugRecordingUrl(path){return `${API_BASE}/local-assessment-recordings/debug/${path}?local_preview=1`;}
async function initializeLocalReview(){
  if(!localReview.enabled)return;
  if(localReview.active)await finishLocalReview({task_id:localReview.active.taskId,metrics:{stopped:true}});
  localReview.session=null;localReview.results={};localReview.error=null;reviewStatus('');
  try{
    const response=await fetch(debugRecordingUrl('sessions'),{method:'POST',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Local debug folder could not be reset (${response.status}).`);
    localReview.session=await response.json();
    postRN({type:'assessment_debug_session',...localReview.session});
  }catch(error){localReview.error=String(error);reviewStatus(`Debug recording unavailable: ${localReview.error}`);}
}
function sampleLocalReviewGeometry(recording,now){
  if(now-(recording.lastGeometryAt || 0)<200 || recording.geometry.length>=18000)return;
  recording.lastGeometryAt=now;
  const step=getCurrentStep(),target=step && getEffectiveTargetXY(step);
  const point=p=>p && {x:p.x,y:p.y,z:p.z,visibility:p.visibility};
  recording.geometry.push({video_ms:Math.round(now-recording.startedAt),step_id:step?.id,
    pose_age_ms:Math.round(now-lastPoseScanTs),voice_finished_at:voiceFinishedAt,
    target:target && point(targetCanvasPoint(step,target)),radius:step && effectiveRadius(step,latestPoseLandmarks),
    wrist:point(latestPoseLandmarks?.[AFFECTED_SIDE==='left'?15:16]),
    shoulders:[point(latestPoseLandmarks?.[11]),point(latestPoseLandmarks?.[12])],
    lap:point(assessmentLapTarget),lap_locked:assessmentLapTargetLocked,
    hand_open_score:handOpenScore,palm_facing_score:palmFacingScore});
}
function reviewPhase(){
  if(calibratingAssessment)return 'Camera / lap calibration';
  if(testingReachEnabled() && !reachCanMeasure())return 'Paused / instructions / target moving - not scoring';
  return getCurrentStep()?.caption || getCurrentStep()?.id || 'Task finished';
}
function drawLocalReview(recording){
  if(recording.stopping)return;
  const c=recording.context,w=recording.canvas.width,h=recording.imageHeight,now=performance.now();
  sampleLocalReviewGeometry(recording,now);
  c.fillStyle='#10251f';c.fillRect(0,0,w,recording.canvas.height);
  if(video.readyState>=2){
    c.save();c.translate(w,0);c.scale(-1,1);c.drawImage(video,0,0,w,h);
    if(canvas.width&&canvas.height)c.drawImage(canvas,0,0,w,h);c.restore();
  }
  const raw=video.readyState>=2 && now-lastPoseScanTs<=250 && now-lastAngleVideoAt<=250 ? assessmentQuality.raw(latestPoseLandmarks,latestPoseWorldLandmarks,video.videoWidth/video.videoHeight) : {};
  const rubric=assessmentQuality.rubric;
  const fmt=v=>Number.isFinite(v)?`${v.toFixed(1)}°`:'not tracked';
  c.font='18px sans-serif';c.fillStyle='#fff';
  c.fillText(`${recording.taskId}  |  video ${((now-recording.startedAt)/1000).toFixed(1)} s  |  ${reviewPhase()}`,16,h+27,w-32);
  const mouth=recording.taskId==='T3';
  const keys=mouth && rubric ? rubric.criteria.map(rule=>rule.metric) : ['arm_elevation','elbow_extension'];
  const evidence=mouth?assessmentQuality.snapshot():null;
  keys.forEach((key,i)=>{
    const rule=rubric?.criteria.find(r=>r.metric===key),measurement=assessmentQuality.measurements[key];
    const label=key==='arm_elevation'?'Arm elevation (model 3D)':key==='elbow_flexion'?'Elbow bend (2D)':key==='target_control'?'Target control':'Elbow extension (2D)';
    const unit=v=>key==='target_control'?(Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'not tracked'):fmt(v);
    c.fillStyle=i?'#facc15':'#67e8f9';
    const statistic=evidence?.measurements[key];
    c.fillText(mouth
      ? `${label} | reference: ${rule?unit(rule.target):'not used'} | ${statistic?.statistic_source||'collecting'}: ${statistic?.samples>=5?unit(statistic.value):'not measured'}`
      : `${label}: ${fmt(raw[key])}   |   reference: ${rule?fmt(rule.target):'not used in this step'}   |   valid peak: ${fmt(measurement?.peak?.value)}`,16,h+57+i*28,w-32);
  });
  c.fillStyle='#fff';c.font='16px sans-serif';
  const caption=((mouth?document.getElementById('mouthCaption')?.textContent:document.getElementById('reachGuidance')?.textContent) || voiceText.textContent || '').trim();
  const words=caption.split(' ');let line='',row=0;
  for(const word of words){if(c.measureText(line+word).width>w-32){c.fillText(line,16,h+113+row*21);line='';if(++row>1)break;}line+=word+' ';}
  if(row<2)c.fillText(line,16,h+113+row*21);
  recording.raf=requestAnimationFrame(()=>drawLocalReview(recording));
}
function startLocalReview(taskId){
  if(!localReview.enabled || !localReview.session || localReview.active || !video.srcObject)return;
  try{
    if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream)throw new Error('This browser cannot record the camera overlay.');
    const surface=document.createElement('canvas');surface.width=960;
    const imageHeight=Math.round(960*video.videoHeight/video.videoWidth);surface.height=imageHeight+155;
    const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(x=>MediaRecorder.isTypeSupported(x));
    if(!mime)throw new Error('No supported video recording format.');
    const recording={taskId,sessionId:localReview.session.session_id,canvas:surface,context:surface.getContext('2d'),imageHeight,startedAt:performance.now(),chunks:[],timeline:[],geometry:[],stopping:false,calibrationIncluded:calibratingAssessment};
    const stream=surface.captureStream(20);recording.stream=stream;
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1200000});recording.recorder=recorder;
    recorder.ondataavailable=e=>{if(e.data.size)recording.chunks.push(e.data);};
    recorder.onerror=()=>{recording.error='Video recording was interrupted; the saved file may be incomplete.';reviewStatus(recording.error);};
    localReview.active=recording;drawLocalReview(recording);recorder.start(1000);
    reviewStatus('');
  }catch(error){
    const recording=localReview.active;
    if(recording){recording.stopping=true;cancelAnimationFrame(recording.raf);recording.stream?.getTracks().forEach(t=>t.stop());localReview.active=null;}
    localReview.error=String(error);reviewStatus(`Recording unavailable: ${localReview.error}`);
  }
}
function markLocalReviewStep(stepId){
  const r=localReview.active;if(r)r.timeline.push({step_id:stepId,instruction_start_video_ms:Math.round(performance.now()-r.startedAt)});
}
async function saveLocalDebugBlob(recording,blob,duration,taskResult){
  const evidence={task_result:taskResult || {task_id:recording.taskId},side:AFFECTED_SIDE,video_duration_ms:duration,
    calibration_included:recording.calibrationIncluded,
    timeline:recording.timeline,geometry:recording.geometry,
    notes:recording.notes || 'Mirrored full camera view with aligned target overlay. Camera coordinates, confidence, voice and hold timing included; microphone not recorded.'};
  let saved=null;
  const path=`sessions/${recording.sessionId}/tasks/${recording.taskId}`;
  for(let attempt=0;attempt<2;attempt++){
    try{
      if(!saved){
        const response=await fetch(`${debugRecordingUrl(`${path}/video`)}&duration_ms=${duration}`,{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal:AbortSignal.timeout(30000)});
        if(response.status===409)return {status:'superseded'};
        if(!response.ok)throw new Error(`Local video save failed (${response.status}).`);saved=await response.json();
      }
      const response=await fetch(debugRecordingUrl(`${path}/evidence`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(evidence),signal:AbortSignal.timeout(30000)});
      if(response.status===409)return {status:'superseded'};
      if(!response.ok)throw new Error(`Angle evidence save failed (${response.status}).`);
      saved=await response.json();
      const url=new URL(debugRecordingUrl(`${path}/video`),location.href);
      saved.playback_url=url.href;saved.warning=recording.error || null;
      postRN({type:'assessment_debug_video_saved',...saved});return saved;
    }catch(error){
      localReview.error=String(error);
    }
  }
  // Debug storage never asks the patient to touch the screen to continue.
  reviewStatus(`Debug video save failed: ${localReview.error}`);
  return {status:'error',error:localReview.error};
}
async function saveLocalReview(recording,taskResult){
  recording.stopping=true;cancelAnimationFrame(recording.raf);
  const duration=Math.round(performance.now()-recording.startedAt);
  try{
    if(recording.recorder.state!=='inactive')await new Promise(resolve=>{recording.recorder.onstop=resolve;recording.recorder.stop();});
    const blob=new Blob(recording.chunks,{type:recording.recorder.mimeType});recording.chunks=[];
    return await saveLocalDebugBlob(recording,blob,duration,taskResult);
  }finally{recording.stream.getTracks().forEach(t=>t.stop());}
}
async function saveLocalWalkingReview(file,validation,taskResult){
  if(!localReview.enabled || !localReview.session)return;
  const recording={taskId:taskResult.task_id,sessionId:localReview.session.session_id,timeline:[],geometry:[],
    calibrationIncluded:false,notes:'Walking video selected or recorded on this device. Original source video; no extra microphone capture.'};
  const blob=file.type?file:new Blob([file],{type:walkingVideoContentType(file)});
  localReview.results[recording.taskId]=await saveLocalDebugBlob(recording,blob,validation.durationMs,taskResult);
}
async function finishLocalReview(taskResult){
  if(!localReview.enabled)return null;
  const r=localReview.active;
  if(r){
    if(!r.saving)r.saving=saveLocalReview(r,taskResult);
    const result=await r.saving;localReview.results[r.taskId]=result;localReview.active=null;return result;
  }
  return localReview.results[taskResult?.task_id] || (localReview.error?{status:'error',error:localReview.error}:null);
}
