// Adapted from assessment-service/backend/fast_screening.py (rehyn-fast-1.6-early-smile-drop).
// Regenerate with: node scripts/sync-fast-check.mjs. The backend/native runner stays unchanged.
import { createFastCheckHost } from "./fast-check-host";

export function mountFastCheck(root, base, onExit, onRestart) {
const host=createFastCheckHost(root,base,onExit,onRestart);
const {document,fetch,setTimeout,clearTimeout,requestAnimationFrame,cancelAnimationFrame}=host;
const navigator={mediaDevices:{getUserMedia:host.getUserMedia}};
root.innerHTML="<div class=\"shell\">\n  <div class=\"top\"><button class=\"exit\" type=\"button\" data-fast-action=\"exit\">Leave</button><span style=\"width:44px\"></span></div>\n  <div class=\"workspace\" id=\"workspace\">\n    <section class=\"camera\" id=\"cameraPane\">\n      <video id=\"video\" playsinline autoplay muted></video>\n      <canvas id=\"canvas\"></canvas>\n      <div class=\"cameraLabel\" id=\"cameraLabel\">Camera assistance starts only when you begin. A carer or family member should make the final observation.</div>\n    </section>\n    <section class=\"panel\" id=\"panel\"></section>\n  </div>\n</div>";
let PoseLandmarker, FaceLandmarker, FilesetResolver, DrawingUtils;

const video=document.getElementById("video"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),panel=document.getElementById("panel"),cameraLabel=document.getElementById("cameraLabel");
const answers={face:null,arms:null,speech:null};
const automated={
  face:{available:false,positive:false,decision:"pending",samples:0,positive_samples:0,engaged_samples:0,smile_streak:0,smile_was_established:false,smile_drop_started_at:null,metric:null,smile_activation:null,quality:"pending",reason:""},
  arms:{available:false,positive:false,decision:"pending",samples:0,positive_samples:0,both_raised_samples:0,one_sided_samples:0,metric:null,quality:"pending",reason:""},
  speech:{available:false,positive:false,decision:"pending",transcript:"",similarity:null,confidence:null,quality:"pending",reason:"",provider:"openai",model:"gpt-transcribe",recording_retained:false}
};
let poseLandmarker=null,faceLandmarker=null,stream=null,current="intro",lastVideoTime=-1,animationId=null,stepStartedAt=0,stepTimer=null,speechRecorder=null,speechAudioStream=null,speechTimer=null,reported=false,aliraSpeechAudio=null,aliraSpeechToken=0;
let armBaseline=null,speechSettled=false,speechAwaitingRetry=false,speechBest={transcript:"",confidence:0,score:0},speechAudioContext=null,speechVadFrame=null;
const phrase="The sky is blue today";
const FACE_WINDOW_MS=5600,FACE_SMILE_ON=.08,FACE_SMILE_OFF=.05,FACE_ESTABLISH_SAMPLES=8,FACE_DROP_CONFIRM_MS=450,ARMS_WINDOW_MS=6800,SPEECH_WINDOW_MS=15000,SPEECH_SILENCE_MS=1300,SPEECH_MIN_TALK_MS=900;

function postRN(data){
  host.onMessage(data);
}
function startDemo911Call(){
  if(document.getElementById("demoCallOverlay")) return;
  const overlay=document.createElement("div");overlay.className="callOverlay";overlay.id="demoCallOverlay";overlay.setAttribute("data-testid","fast-demo-911");
  overlay.innerHTML=`<div class="callCard"><div class="demoBadge">Demo only</div><div class="callPulse">999</div><h2>Simulating a 999 call...</h2><p>This prototype is demonstrating the emergency handoff that follows a red FAST result.</p><div class="demoWarning">No emergency call has been placed.</div><p class="small">In a real emergency, use a phone to call 999 immediately and say that you suspect a stroke.</p><button class="secondary" id="closeDemoCall" style="width:100%">Close simulation</button></div>`;
  document.body.appendChild(overlay);document.getElementById("closeDemoCall").onclick=()=>overlay.remove();postRN({type:"demo_911_started"});
  speak("Demo only. The app is simulating a 999 call. No emergency call has been placed. In a real emergency, call 999 immediately.");
}
function stopAliraSpeech(){
  aliraSpeechToken+=1;
  if(aliraSpeechAudio){aliraSpeechAudio.onended=null;aliraSpeechAudio.onerror=null;try{aliraSpeechAudio.pause()}catch{}aliraSpeechAudio=null}
  try{speechSynthesis.cancel()}catch{}
}
function speak(text,onEnd){
  stopAliraSpeech();const token=aliraSpeechToken;let finished=false,fallbackStarted=false,watchdog=null;
  const done=()=>{if(finished||token!==aliraSpeechToken)return;finished=true;if(watchdog)clearTimeout(watchdog);if(aliraSpeechAudio){aliraSpeechAudio.onended=null;aliraSpeechAudio.onerror=null;aliraSpeechAudio=null}if(onEnd)onEnd()};
  const browserFallback=()=>{if(fallbackStarted||finished||token!==aliraSpeechToken)return;fallbackStarted=true;if(aliraSpeechAudio){aliraSpeechAudio.onended=null;aliraSpeechAudio.onerror=null;try{aliraSpeechAudio.pause()}catch{}aliraSpeechAudio=null}try{const utterance=new SpeechSynthesisUtterance(text);utterance.rate=.88;utterance.pitch=1;utterance.lang="en-GB";utterance.onend=done;utterance.onerror=done;speechSynthesis.speak(utterance);if(onEnd)watchdog=setTimeout(done,Math.max(5000,text.length*90))}catch{setTimeout(done,250)}};
  void (async()=>{try{const response=await fetch("/api/tts/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});if(!response.ok)throw new Error("OpenAI voice unavailable");const data=await response.json();if(!data.audio_b64)throw new Error("OpenAI voice response was empty");if(token!==aliraSpeechToken)return;const audio=new Audio(`data:audio/mpeg;base64,${data.audio_b64}`);aliraSpeechAudio=audio;audio.onended=done;audio.onerror=browserFallback;await audio.play();if(onEnd)watchdog=setTimeout(done,Math.max(15000,text.length*150))}catch{browserFallback()}})();
}
function progress(index){return `<div class="progress" aria-label="FAST step ${index+1} of 4">${[0,1,2,3].map(i=>`<span class="${i<index?'done':i===index?'active':''}"></span>`).join('')}</div>`}
function distance(a,b){return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0))}
function visible(lm,indexes){return indexes.every(i=>lm[i]&&(lm[i].visibility??1)>.55)}

async function ensureCamera(){
  if(stream&&(poseLandmarker||faceLandmarker)) return true;
  cameraLabel.textContent="Starting private on-device camera assistance...";
  try{
    let cameraTimedOut=false;
    const cameraRequest=navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:960},height:{ideal:720}},audio:false});
    cameraRequest.then(candidate=>{if(cameraTimedOut)candidate.getTracks().forEach(track=>track.stop())}).catch(()=>{});
    stream=await Promise.race([cameraRequest,new Promise((_,reject)=>setTimeout(()=>{cameraTimedOut=true;reject(new Error("camera timeout"))},4500))]);
    if(host.disposed)return false;
    video.srcObject=stream;await video.play();
    ({PoseLandmarker,FaceLandmarker,FilesetResolver,DrawingUtils}=await import(/* @vite-ignore */ host.resource("/vendor/mediapipe/vision_bundle.mjs")));
    if(host.disposed)return false;
    const files=await FilesetResolver.forVisionTasks(host.resource("/vendor/mediapipe/wasm"));
    if(host.disposed)return false;
    const models=await Promise.allSettled([
      PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:host.resource("/vendor/mediapipe/models/pose_landmarker_lite.task")},runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:.55,minPosePresenceConfidence:.55,minTrackingConfidence:.55}).then(model=>host.ownModel(model)),
      FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:host.resource("/vendor/mediapipe/models/face_landmarker.task")},runningMode:"VIDEO",numFaces:1,outputFaceBlendshapes:true,minFaceDetectionConfidence:.55,minFacePresenceConfidence:.55,minTrackingConfidence:.55}).then(model=>host.ownModel(model))
    ]);
    if(host.disposed)return false;
    if(models[0].status==="fulfilled")poseLandmarker=models[0].value;
    if(models[1].status==="fulfilled")faceLandmarker=models[1].value;
    if(!poseLandmarker&&!faceLandmarker)throw new Error("FAST models unavailable");
    cameraLabel.textContent="Camera assistance is ready. Video stays on this device and is not saved.";
    animationId=requestAnimationFrame(loop);
    return true;
  }catch(error){
    if(host.disposed)return false;
    cameraLabel.textContent="Automatic camera observation is unavailable. Alira will mark the camera checks as inconclusive.";
    return false;
  }
}

function loop(){
  if(video.readyState>=2&&(poseLandmarker||faceLandmarker)&&video.currentTime!==lastVideoTime){
    lastVideoTime=video.currentTime;
    if(canvas.width!==video.videoWidth){canvas.width=video.videoWidth;canvas.height=video.videoHeight}
    const now=performance.now();
    const poseResult=poseLandmarker?poseLandmarker.detectForVideo(video,now):null;
    const faceResult=current==="face"&&faceLandmarker?faceLandmarker.detectForVideo(video,now):null;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const poseLm=poseResult&&poseResult.landmarks&&poseResult.landmarks[0];
    if(poseLm){
      const draw=new DrawingUtils(ctx);draw.drawConnectors(poseLm,PoseLandmarker.POSE_CONNECTIONS,{color:"rgba(155,226,182,.78)",lineWidth:3});draw.drawLandmarks(poseLm,{color:"#FFFFFF",fillColor:"#B42318",radius:3});
    }
    if(current==="face")analyseFace(faceResult,poseLm);
    if(current==="arms"&&poseLm)analyseArms(poseLm);
  }
  animationId=requestAnimationFrame(loop);
}

function analyseFace(faceResult,poseLm){
  const face=automated.face;
  if(face.decision!=="pending")return;
  const faceLm=faceResult&&faceResult.faceLandmarks&&faceResult.faceLandmarks[0];
  const categories=faceResult&&faceResult.faceBlendshapes&&faceResult.faceBlendshapes[0]&&faceResult.faceBlendshapes[0].categories;
  if(faceLm&&categories){
    const scores={};categories.forEach(item=>{scores[item.categoryName]=item.score||0});
    const smileLeft=scores.mouthSmileLeft||0,smileRight=scores.mouthSmileRight||0;
    const smileActivation=(smileLeft+smileRight)/2,blendAsymmetry=Math.abs(smileLeft-smileRight);
    const faceWidth=Math.max(distance(faceLm[33],faceLm[263]),.04);
    const headTilt=faceLm[33].y-faceLm[263].y,mouthTilt=faceLm[61].y-faceLm[291].y;
    const landmarkAsymmetry=Math.abs(mouthTilt-headTilt)/faceWidth;
    const metric=Math.max(blendAsymmetry,landmarkAsymmetry);
    face.available=true;face.samples+=1;face.quality="face_landmarker";face.metric=Number(metric.toFixed(3));face.smile_activation=Number(smileActivation.toFixed(3));
    const now=performance.now();
    if(smileActivation>FACE_SMILE_ON){
      face.engaged_samples+=1;face.smile_streak+=1;face.last_engaged_at=now;face.smile_drop_started_at=null;
      if(face.smile_streak>=FACE_ESTABLISH_SAMPLES)face.smile_was_established=true;
    }else if(smileActivation<FACE_SMILE_OFF){
      face.smile_streak=0;
      if(face.smile_was_established&&!face.smile_drop_started_at)face.smile_drop_started_at=now;
    }
    if(smileActivation>FACE_SMILE_ON&&(blendAsymmetry>.22||landmarkAsymmetry>.17))face.positive_samples+=1;
    face.positive=face.samples>=16&&face.positive_samples/face.samples>.26;
    if(!face.positive&&face.smile_was_established&&face.smile_drop_started_at&&now-face.smile_drop_started_at>=FACE_DROP_CONFIRM_MS){
      if(stepTimer)clearTimeout(stepTimer);
      const reason="The smile dropped after it was detected and was not maintained, which is treated as a possible facial sign.";
      face.reason=reason;updateAssist("face","Smile drop detected. Moving to the arm check now.","warn");showAutomaticDecision("face","yes",reason,renderArms,650);return;
    }
    if(!face.positive&&smileActivation>FACE_SMILE_ON&&now-stepStartedAt>=2600&&face.engaged_samples>=40&&face.positive_samples/face.samples<=.15){
      if(stepTimer)clearTimeout(stepTimer);updateAssist("face","A steady, even smile was seen. Moving on.","good");finalizeFace();return;
    }
    updateAssist("face",face.positive?"Alira noticed persistent left-right smile unevenness.":smileActivation>FACE_SMILE_ON?"Smile detected. Comparing both sides now.":face.smile_drop_started_at?"Smile changed. Confirming the change now.":"Please smile and hold while Alira observes both sides.",face.positive?"warn":"good");
    return;
  }
  if(!poseLm||!visible(poseLm,[2,5,9,10]))return;
  const faceWidth=Math.max(distance(poseLm[2],poseLm[5]),distance(poseLm[9],poseLm[10]),.02);
  const corrected=Math.abs((poseLm[9].y-poseLm[10].y)-(poseLm[2].y-poseLm[5].y))/faceWidth;
  face.available=true;face.samples+=1;face.quality="pose_fallback";face.metric=Number(corrected.toFixed(3));
  if(corrected>.24)face.positive_samples+=1;
  face.positive=face.samples>=12&&face.positive_samples/face.samples>.38;
  updateAssist("face",face.positive?"Alira noticed possible left-right smile unevenness.":"Face found. The detailed smile model is still loading.",face.positive?"warn":"good");
}

function analyseArms(lm){
  if(automated.arms.decision!=="pending")return;
  if(!visible(lm,[11,12,13,14,15,16])) return;
  const arms=automated.arms;
  const shoulderWidth=Math.max(distance(lm[11],lm[12]),.04);
  const leftHeight=(lm[15].y-lm[11].y)/shoulderWidth,rightHeight=(lm[16].y-lm[12].y)/shoulderWidth;
  const leftRaised=leftHeight<=.62,rightRaised=rightHeight<=.62;
  const wristDifference=Math.abs(lm[15].y-lm[16].y)/shoulderWidth;
  const oneSided=leftRaised!==rightRaised;
  if(leftRaised&&rightRaised&&!armBaseline)armBaseline={left:leftHeight,right:rightHeight};
  const leftDrift=armBaseline?leftHeight-armBaseline.left:0,rightDrift=armBaseline?rightHeight-armBaseline.right:0;
  const unilateralDrift=(leftDrift>.30&&rightDrift<.16)||(rightDrift>.30&&leftDrift<.16);
  const possibleDifference=oneSided||(leftRaised&&rightRaised&&(wristDifference>.42||unilateralDrift));
  arms.available=true;arms.samples+=1;arms.quality="pose_landmarker";arms.metric=Number(Math.max(wristDifference,leftDrift,rightDrift).toFixed(3));
  if(leftRaised&&rightRaised){arms.both_raised_samples+=1;arms.last_both_raised_at=performance.now()}
  if(oneSided)arms.one_sided_samples+=1;
  if(possibleDifference)arms.positive_samples+=1;
  arms.positive=arms.samples>=18&&(arms.one_sided_samples/arms.samples>.30||(arms.both_raised_samples>=10&&arms.positive_samples/arms.samples>.42));
  if(!arms.positive&&performance.now()-stepStartedAt>=3000&&arms.both_raised_samples>=45&&arms.one_sided_samples/arms.samples<=.12&&arms.positive_samples/arms.samples<=.2){
    if(stepTimer)clearTimeout(stepTimer);updateAssist("arms","Both arms held steady. Moving on.","good");finalizeArms();return;
  }
  if(!arms.positive&&arms.both_raised_samples>=8&&arms.both_raised_samples<45&&arms.last_both_raised_at&&performance.now()-arms.last_both_raised_at>=1200){
    if(stepTimer)clearTimeout(stepTimer);finalizeArms();return;
  }
  updateAssist("arms",arms.positive?"Alira noticed one arm staying lower or drifting.":leftRaised&&rightRaised?"Both arms found. Keep holding while Alira watches for drift.":oneSided?"One arm is raised. Keep trying to lift both.":"Raise both arms and hold them there.",arms.positive?"warn":"good");
}

function updateAssist(sign,text,state){
  if(current!==sign) return;const el=document.getElementById("assist");if(!el)return;el.className=`assist ${state||''}`;el.querySelector("span:last-child").textContent=text;
}

function beginScan(duration){const fill=document.getElementById("scanFill");if(!fill)return;fill.style.transition="none";fill.style.width="0";requestAnimationFrame(()=>{fill.style.transition=`width ${duration}ms linear`;requestAnimationFrame(()=>{fill.style.width="100%"})})}
function setStepTimer(callback,duration){if(stepTimer)clearTimeout(stepTimer);stepTimer=setTimeout(callback,duration)}
function automaticCard(label){return `<div class="autoCard"><div class="autoTop"><span>${label}</span><span class="autoBadge">Automatic</span></div><div class="scanTrack"><div class="scanFill" id="scanFill"></div></div><div class="autoResult" id="autoResult" aria-live="polite"><span class="pulseDot"></span><span>Observing now. Alira will move on automatically.</span></div></div>`}
function showAutomaticDecision(sign,decision,text,next,delayMs=1100){
  answers[sign]=decision;automated[sign].decision=decision;automated[sign].positive=decision==="yes";
  const fill=document.getElementById("scanFill");if(fill){fill.style.transition="none";fill.style.width="100%"}
  const el=document.getElementById("autoResult");if(el){el.className=`autoResult ${decision==="yes"||decision==="unsure"?"warn":"clear"}`;el.innerHTML=`<strong>${decision==="yes"?"Possible FAST sign detected":decision==="no"?"No FAST sign detected in this step":"Check inconclusive"}</strong><span>${text}</span>`}
  setTimeout(next,delayMs);
}
function finalizeFace(){
  const face=automated.face;let decision="unsure",reason="The face or smile could not be measured clearly.";
  if(face.samples>=12&&face.positive_samples/face.samples>.26){decision="yes";reason="Persistent left-right smile unevenness was detected."}
  else if(face.quality==="face_landmarker"&&face.smile_was_established&&face.smile_drop_started_at){decision="yes";reason="The smile dropped after it was detected and was not maintained, which is treated as a possible facial sign."}
  else if(face.quality==="face_landmarker"&&face.engaged_samples>=8&&face.engaged_samples<40){decision="yes";reason="The smile faded quickly and could not be held, which is treated as a possible facial sign."}
  else if(face.quality==="face_landmarker"&&face.samples>=18&&face.engaged_samples>=40&&face.positive_samples/face.samples<=.26){decision="no";reason="A smile was held without persistent left-right unevenness."}
  face.reason=reason;showAutomaticDecision("face",decision,reason,renderArms);
}
function finalizeArms(){
  const arms=automated.arms;let decision="unsure",reason="Both arms could not be observed in a sustained raised position.";
  if(arms.samples>=18&&(arms.one_sided_samples/arms.samples>.30||(arms.both_raised_samples>=10&&arms.positive_samples/arms.samples>.42))){decision="yes";reason="One arm stayed lower or drifted during the hold."}
  else if(arms.both_raised_samples>=8&&arms.both_raised_samples<45){decision="yes";reason="The raised position was lost quickly and could not be held, which is treated as a possible arm sign."}
  else if(arms.samples>=18&&arms.both_raised_samples>=45&&arms.positive_samples/arms.samples<=.42){decision="no";reason="Both arms stayed raised without persistent one-sided drift."}
  arms.reason=reason;showAutomaticDecision("arms",decision,reason,renderSpeech);
}

function normalizeSpeech(text){return String(text||"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
function editDistance(a,b){const dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));for(let i=0;i<=a.length;i++)dp[i][0]=i;for(let j=0;j<=b.length;j++)dp[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return dp[a.length][b.length]}
function similarity(a,b){a=normalizeSpeech(a);b=normalizeSpeech(b);return Math.max(0,1-editDistance(a,b)/Math.max(a.length,b.length,1))}
function cancelSpeechCapture(){
  if(speechTimer)clearTimeout(speechTimer);speechTimer=null;
  stopSpeechVoiceMonitor();
  if(speechRecorder){const recorder=speechRecorder;speechRecorder=null;recorder.onstop=null;try{if(recorder.state!=="inactive")recorder.stop()}catch{}}
  if(speechAudioStream){speechAudioStream.getTracks().forEach(track=>track.stop());speechAudioStream=null}
}
function stopSpeechVoiceMonitor(){
  if(speechVadFrame)cancelAnimationFrame(speechVadFrame);speechVadFrame=null;
  if(speechAudioContext){try{speechAudioContext.close()}catch{}speechAudioContext=null}
}
function startSpeechVoiceMonitor(recorder){
  const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx||!speechAudioStream)return;
  try{
    speechAudioContext=new AudioCtx();
    const source=speechAudioContext.createMediaStreamSource(speechAudioStream);
    const analyser=speechAudioContext.createAnalyser();analyser.fftSize=1024;source.connect(analyser);
    const samples=new Float32Array(analyser.fftSize);
    const startedAt=performance.now();let noiseFloor=.006,lastTick=startedAt,voiceStartedAt=0,lastVoiceAt=0,talkedMs=0,heardAnnounced=false;
    const tick=()=>{
      speechVadFrame=null;
      if(speechRecorder!==recorder||speechSettled||speechAwaitingRetry||recorder.state==="inactive"){stopSpeechVoiceMonitor();return}
      analyser.getFloatTimeDomainData(samples);
      let sum=0;for(let i=0;i<samples.length;i++)sum+=samples[i]*samples[i];
      const rms=Math.sqrt(sum/samples.length);
      const now=performance.now(),elapsed=Math.min(now-lastTick,120);lastTick=now;
      if(now-startedAt<450){
        noiseFloor=Math.max(noiseFloor,rms*1.15);
      }else{
        const speaking=rms>Math.max(noiseFloor*2.5,.012);
        if(speaking){
          if(!voiceStartedAt)voiceStartedAt=now;
          lastVoiceAt=now;talkedMs+=elapsed;
          if(!heardAnnounced&&talkedMs>350){heardAnnounced=true;const status=document.getElementById("transcript");if(status)status.textContent="Alira can hear you. Finish the phrase, then pause - the check continues automatically."}
        }else{
          noiseFloor=noiseFloor*.98+rms*.02;
          if(voiceStartedAt&&talkedMs>=SPEECH_MIN_TALK_MS&&now-lastVoiceAt>=SPEECH_SILENCE_MS){
            stopSpeechVoiceMonitor();
            try{if(recorder.state!=="inactive")recorder.stop()}catch{}
            return;
          }
        }
      }
      speechVadFrame=requestAnimationFrame(tick);
    };
    speechVadFrame=requestAnimationFrame(tick);
  }catch{stopSpeechVoiceMonitor()}
}
function finishSpeech(decision,reason){
  if(speechSettled)return;speechSettled=true;
  speechAwaitingRetry=false;
  cancelSpeechCapture();
  automated.speech.reason=reason;showAutomaticDecision("speech",decision,reason,showResult);
}
function rememberSpeechCandidate(transcript,confidence){
  const clean=normalizeSpeech(transcript);if(!clean)return;
  const score=similarity(clean,phrase);if(score>speechBest.score)speechBest={transcript:clean,confidence:confidence||0,score};
}
function isCompleteSpeechCandidate(candidate){
  const clean=normalizeSpeech(candidate?.transcript),words=clean.split(" ").filter(Boolean);
  return words.length>=5&&(words.includes("today")||clean.endsWith("to day"));
}
function pauseForIncompleteSpeech(reason){
  if(speechSettled||speechAwaitingRetry)return;speechAwaitingRetry=true;
  cancelSpeechCapture();
  const best=speechBest;
  automated.speech.available=Boolean(best.transcript);automated.speech.quality=best.transcript?"partial_phrase":"no_clear_phrase";automated.speech.transcript=best.transcript;automated.speech.similarity=best.transcript?Number(best.score.toFixed(3)):null;automated.speech.confidence=best.transcript?Number(best.confidence.toFixed(3)):null;automated.speech.reason=reason;
  const status=document.getElementById("transcript");if(status)status.textContent="The check was interrupted by a technical problem. No emergency result has been decided.";
  const result=document.getElementById("autoResult");if(result){result.className="autoResult warn";result.innerHTML=`<strong>Speech check paused</strong><span>${reason}</span>`}
  const existing=document.getElementById("speechRetryActions");if(existing)existing.remove();
  const actions=document.createElement("div");actions.className="actions";actions.id="speechRetryActions";actions.innerHTML=`<button class="primary" data-testid="fast-speech-retry" id="retrySpeech">Try speech again</button><button class="secondary" data-testid="fast-speech-unable" id="unableSpeech">I cannot complete the phrase</button>`;
  const card=document.querySelector(".autoCard");if(card)card.insertAdjacentElement("afterend",actions);
  document.getElementById("retrySpeech").onclick=()=>{speechBest={transcript:"",confidence:0,score:0};speechAwaitingRetry=false;actions.remove();if(status)status.textContent="Preparing to listen again...";speak(`Please repeat: ${phrase}.`,startSpeechCheck)};
  document.getElementById("unableSpeech").onclick=()=>{actions.remove();speechAwaitingRetry=false;finishSpeech("unsure","The complete phrase could not be captured, so speech difficulty could not be ruled out.")};
}
function speechMimeType(){
  if(typeof MediaRecorder==="undefined"||typeof MediaRecorder.isTypeSupported!=="function")return "";
  return ["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4"].find(type=>MediaRecorder.isTypeSupported(type))||"";
}
function speechFilename(type){const value=String(type||"").toLowerCase();return value.includes("ogg")?"fast-speech.ogg":value.includes("mp4")?"fast-speech.mp4":"fast-speech.webm"}
async function transcribeSpeechRecording(blob){
  if(speechSettled||speechAwaitingRetry)return;
  const status=document.getElementById("transcript");
  if(status)status.textContent="Alira is securely transcribing the short recording...";
  const fill=document.getElementById("scanFill");if(fill){fill.style.transition="none";fill.style.width="100%"}
  const result=document.getElementById("autoResult");if(result)result.innerHTML="<span class=\"pulseDot\"></span><span>OpenAI speech-to-text is processing the phrase. The audio is not retained by Rehyn.</span>";
  try{
    const form=new FormData();form.append("file",blob,speechFilename(blob.type));
    const response=await fetch("/api/stt/transcribe",{method:"POST",body:form});
    const data=await response.json().catch(()=>({}));
    if(host.disposed)return;
    if(!response.ok)throw new Error(data.detail||"Transcription failed");
    const transcript=String(data.text||"").trim();rememberSpeechCandidate(transcript,0);
    const best=speechBest,wordCount=best.transcript?best.transcript.split(" ").filter(Boolean).length:0;
    automated.speech.available=Boolean(best.transcript);automated.speech.quality=best.transcript?"openai_transcription":"no_clear_phrase";automated.speech.transcript=best.transcript;automated.speech.similarity=best.transcript?Number(best.score.toFixed(3)):null;automated.speech.confidence=null;automated.speech.provider=String(data.provider||"openai");automated.speech.model=String(data.model||"gpt-transcribe");automated.speech.recording_retained=false;
    if(status&&transcript)status.textContent=`Alira heard: "${transcript}"`;
    if(!isCompleteSpeechCandidate(best)){
      // The recording and transcription worked, but the patient's phrase was
      // not heard clearly or completely. That is treated as a possible speech
      // sign and escalates immediately - it is not a technical failure.
      finishSpeech("yes",best.transcript?"Only part of the phrase could be heard clearly, so a possible speech sign is treated as present.":"No clear speech could be heard when repeating the phrase, so a possible speech sign is treated as present.");
      return;
    }
    const decision=best.score>=.72?"no":best.score<.48&&wordCount>=5?"yes":"unsure";
    const reason=decision==="no"?"The complete repeated phrase matched clearly.":decision==="yes"?"The complete phrase was substantially different or unclear.":"The complete phrase could not be matched clearly enough to rule out a speech sign.";
    finishSpeech(decision,reason);
  }catch(error){if(host.disposed)return;pauseForIncompleteSpeech("The transcription service could not process the recording. No emergency result has been decided. Please try again.")}
}
async function startSpeechCheck(){
  if(speechSettled||speechAwaitingRetry)return;
  const status=document.getElementById("transcript");
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){pauseForIncompleteSpeech("Audio recording is unavailable on this device. No emergency result has been decided.");return}
  cancelSpeechCapture();
  try{
    speechAudioStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1},video:false});
    if(host.disposed)return;
    const mimeType=speechMimeType(),chunks=[];const recorder=new MediaRecorder(speechAudioStream,mimeType?{mimeType}:undefined);speechRecorder=recorder;let captureFailed=false;
    recorder.ondataavailable=event=>{if(event.data&&event.data.size>0)chunks.push(event.data)};
    recorder.onerror=()=>{captureFailed=true;pauseForIncompleteSpeech("The microphone recording was interrupted. No emergency result has been decided. Please try again.")};
    recorder.onstop=()=>{if(speechTimer)clearTimeout(speechTimer);speechTimer=null;stopSpeechVoiceMonitor();if(speechAudioStream){speechAudioStream.getTracks().forEach(track=>track.stop());speechAudioStream=null}if(speechRecorder===recorder)speechRecorder=null;if(captureFailed)return;const blob=new Blob(chunks,{type:recorder.mimeType||mimeType||"audio/webm"});if(!blob.size){pauseForIncompleteSpeech("No audio was captured. No emergency result has been decided. Please try again.");return}void transcribeSpeechRecording(blob)};
    recorder.start(250);if(status)status.textContent="Listening now. Say the complete phrase, then pause - Alira notices when you finish.";beginScan(SPEECH_WINDOW_MS);startSpeechVoiceMonitor(recorder);speechTimer=setTimeout(()=>{if(recorder.state!=="inactive")recorder.stop()},SPEECH_WINDOW_MS);
  }catch(error){if(host.disposed)return;pauseForIncompleteSpeech("Microphone access is unavailable. No emergency result has been decided. Allow microphone access, then try again.")}
}

function renderIntro(){
  current="intro";document.body.classList.add("intro-mode");panel.innerHTML=`<h1>Think FAST</h1><p>Alira will guide Face, Arms and Speech, observe each response automatically, and move to the next step without asking you to judge the result.</p><div class="actions"><button class="primary" data-testid="fast-start" id="begin">Begin automatic FAST check</button></div><p class="source">Based on CDC FAST guidance.</p>`;
  document.getElementById("begin").onclick=async(event)=>{event.currentTarget.disabled=true;await ensureCamera();if(!host.disposed)renderFace()};
}
function renderFace(){
  current="face";document.body.classList.remove("intro-mode");stepStartedAt=performance.now();automated.face={available:false,positive:false,decision:"pending",samples:0,positive_samples:0,engaged_samples:0,smile_streak:0,smile_was_established:false,smile_drop_started_at:null,metric:null,smile_activation:null,quality:"pending",reason:""};
  panel.innerHTML=`${progress(0)}<div class="letter">F</div><div class="eyebrow">Face · automatic observation</div><h1>Please smile and hold</h1><p>Keep your face toward the camera. Alira is checking whether both sides of the smile move evenly.</p><div class="assist" id="assist"><span class="assistDot"></span><span>Finding the face and waiting for a smile.</span></div>${automaticCard("Smile observation")}`;speak("Face. Please smile and hold while I compare both sides.",()=>{if(current!=="face")return;stepStartedAt=performance.now();automated.face={available:false,positive:false,decision:"pending",samples:0,positive_samples:0,engaged_samples:0,smile_streak:0,smile_was_established:false,smile_drop_started_at:null,metric:null,smile_activation:null,quality:"pending",reason:""};beginScan(FACE_WINDOW_MS);setStepTimer(finalizeFace,FACE_WINDOW_MS)});
}
function renderArms(){
  current="arms";stepStartedAt=performance.now();armBaseline=null;automated.arms={available:false,positive:false,decision:"pending",samples:0,positive_samples:0,both_raised_samples:0,one_sided_samples:0,metric:null,quality:"pending",reason:""};
  panel.innerHTML=`${progress(1)}<div class="letter">A</div><div class="eyebrow">Arms · automatic observation</div><h1>Raise both arms and hold</h1><p>Lift both arms to a comfortable level and keep them there until Alira moves on.</p><div class="assist" id="assist"><span class="assistDot"></span><span>Finding both shoulders, elbows and hands.</span></div>${automaticCard("Arm lift and drift observation")}`;speak("Arms. Please raise both arms and keep them there while I watch for one arm drifting down.",()=>{if(current!=="arms")return;stepStartedAt=performance.now();armBaseline=null;automated.arms={available:false,positive:false,decision:"pending",samples:0,positive_samples:0,both_raised_samples:0,one_sided_samples:0,metric:null,quality:"pending",reason:""};beginScan(ARMS_WINDOW_MS);setStepTimer(finalizeArms,ARMS_WINDOW_MS)});
}
function renderSpeech(){
  current="speech";speechSettled=false;speechAwaitingRetry=false;speechBest={transcript:"",confidence:0,score:0};automated.speech={available:false,positive:false,decision:"pending",transcript:"",similarity:null,confidence:null,quality:"pending",reason:"",provider:"openai",model:"gpt-transcribe",recording_retained:false};
  panel.innerHTML=`${progress(2)}<div class="letter">S</div><div class="eyebrow">Speech · OpenAI transcription</div><h1>Repeat the phrase aloud</h1><p>After Alira reads the phrase, speak at your own pace. As soon as you finish speaking, Alira stops listening automatically and OpenAI converts the recording to text.</p><div class="phrase">"${phrase}."</div><div class="transcript" id="transcript" aria-live="polite">Preparing the microphone...</div>${automaticCard("Speech and understanding observation")}<p class="privacyNote">This short recording is sent securely to OpenAI for transcription. Rehyn does not retain the audio. If the recording or transcription fails for a technical reason, no emergency result is decided and you can try again. If the phrase cannot be heard clearly, Alira treats it as a possible speech sign.</p>`;speak(`Speech. Please repeat: ${phrase}.`,startSpeechCheck);
}

function outcome(){
  const observed=["face","arms","speech"].filter(sign=>answers[sign]==="yes"||automated[sign].positive);
  const uncertain=["face","arms","speech"].filter(sign=>answers[sign]==="unsure"||automated[sign].decision==="unsure");
  return {call_999:observed.length>0||uncertain.length>0,observed_signs:observed,uncertain_signs:uncertain};
}
function showResult(){
  current="result";if(stepTimer)clearTimeout(stepTimer);cancelSpeechCapture();if(animationId)cancelAnimationFrame(animationId);if(stream)stream.getTracks().forEach(track=>track.stop());
  const result=outcome();document.getElementById("cameraPane").classList.add("hidden");panel.classList.add("hidden");
  const workspace=document.getElementById("workspace");const resultSection=document.createElement("section");resultSection.className="result";
  if(result.call_999){
    resultSection.innerHTML=`<div class="resultInner">${progress(3)}<div class="resultIcon">!</div><div class="eyebrow">T - Time · Red flag</div><h1>Call 999 now</h1><p>A FAST sign was noticed or could not be ruled out. Say that you suspect a stroke. Do not wait to see if it passes.</p><button class="callButton" data-testid="fast-show-demo-911" data-fast-action="demo-call">Show demo 999 call</button><div class="onset"><label for="onset">When did the symptoms start? (if known)</label><input id="onset" type="datetime-local" /></div><p class="small">Stay with the person. In a real emergency, call 999 for an ambulance rather than driving to the hospital.</p><button class="secondary" style="width:100%;margin-top:12px" data-fast-action="restart">Restart check</button><p class="source">If symptoms fade, urgent medical help is still needed.</p></div>`;
  }else{
    resultSection.innerHTML=`<div class="resultInner clear">${progress(3)}<div class="resultIcon">&#10003;</div><div class="eyebrow" style="color:#1F7047">T - Time · Green check</div><h1>No FAST signs identified</h1><p>This brief screen did not identify a FAST sign. It does not prove the person is fine and cannot rule out a stroke or TIA.</p><div class="important">Call 999 if symptoms were sudden, have faded, there are other stroke symptoms, or you remain concerned.</div><button class="secondary" style="width:100%" data-fast-action="restart">Restart check</button></div>`;
  }
  workspace.appendChild(resultSection);
  const payload={type:"fast_check_result",answers,automated,result:{...result,status:result.call_999?"call_999":"no_fast_signs_identified",demo_call_911:result.call_999,emergency_call_mode:"simulation"},onset_time:""};postRN(payload);reported=true;
  const onset=document.getElementById("onset");if(onset)onset.onchange=()=>postRN({...payload,onset_time:onset.value});
  speak(result.call_999?"Red flag. Call 999 now and say you suspect a stroke.":"No FAST signs were identified. This does not rule out a stroke. Call 999 if you remain concerned.",result.call_999?()=>setTimeout(startDemo911Call,300):undefined);
}


const click=event=>{
  const button=event.target instanceof Element?event.target.closest("[data-fast-action]"):null;
  if(!button||!root.contains(button))return;
  if(button.dataset.fastAction==="exit")postRN({type:"exit"});
  else if(button.dataset.fastAction==="demo-call")startDemo911Call();
  else if(button.dataset.fastAction==="restart")host.onRestart();
};
root.addEventListener("click",click);
renderIntro();
return ()=>{
  host.dispose();stopAliraSpeech();cancelSpeechCapture();
  video.pause();video.srcObject=null;
  root.removeEventListener("click",click);
  root.classList.remove("intro-mode");root.replaceChildren();
};
}
