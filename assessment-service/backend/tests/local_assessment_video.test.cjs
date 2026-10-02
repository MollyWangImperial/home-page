const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../local_assessment_video.js'),'utf8');

function harness(enabled=true){
  const requests=[],events=[],captureTracks=[];
  const cameraTrack={stopped:false,stop(){this.stopped=true;}};
  const nodes=new Map();
  const element=()=>({hidden:false,textContent:'',style:{},setAttribute(){},append(){},after(){}});
  const document={createElement(kind){
    const node=element();if(kind==='canvas')Object.assign(node,{getContext:()=>({}),captureStream:()=>{
      const track={stopped:false,stop(){this.stopped=true;}};captureTracks.push(track);return {getTracks:()=>[track]};
    }});return node;
  },getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}};
  class Recorder{
    static isTypeSupported(type){return type.includes('webm');}
    constructor(stream,options){this.mimeType=options.mimeType;this.state='inactive';}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['synthetic frames'])});this.onstop();}
  }
  let generation=0,fail=false;
  const context=vm.createContext({LOCAL_PREVIEW_MODE:enabled,API_BASE:'http://localhost:8001/api',AFFECTED_SIDE:'right',
    document,Blob,URL,AbortSignal,performance:{now:()=>1200},MediaRecorder:Recorder,HTMLCanvasElement:{prototype:{captureStream(){}}},
    testingMouthEnabled:()=>false,video:{srcObject:{getTracks:()=>[cameraTrack]},videoWidth:640,videoHeight:480},
    getCurrentStep:()=>({id:'T1-R1',ladderRadius:.14}),getEffectiveTargetXY:()=>({x:.6,y:.4}),targetCanvasPoint:(s,p)=>p,effectiveRadius:()=>.14,
    latestPoseLandmarks:Array.from({length:33},()=>({x:.5,y:.5,visibility:1})),lastPoseScanTs:1190,voiceFinishedAt:100,
    assessmentLapTarget:{x:.57,y:.76},assessmentLapTargetLocked:true,handOpenScore:.9,palmFacingScore:.9,
    calibratingAssessment:true,cancelAnimationFrame(){},postRN:event=>events.push(event),location:{href:'http://localhost:8001/api/pose/runner'},
    walkingVideoContentType:file=>file.type,
    fetch:async(url,options)=>{
      requests.push({url,options});const isSession=new URL(url).pathname.endsWith('/sessions');
      if(fail)return {ok:false,status:500};
      return {ok:true,status:200,json:async()=>isSession?{session_id:`session-${++generation}`,path:'debug/latest'}
        :{status:options.headers['Content-Type']==='application/json'?'saved':'video_saved',task_id:url.includes('/T3/')?'T3':'T1',path:'debug/latest/T1.webm'}};
    }});
  context.window=context;
  vm.runInContext(source+'\ndrawLocalReview=r=>{r.raf=1;sampleLocalReviewGeometry(r,performance.now());};',context);
  return {run:code=>vm.runInContext(code,context),requests,events,captureTracks,cameraTrack,fail:()=>{fail=true;}};
}

test('preview records each task once and saves evidence without stopping the camera between tasks',async()=>{
  const h=harness();await h.run('initializeLocalReview()');h.run("startLocalReview('T1');markLocalReviewStep('T1-R1')");
  const first=h.run("finishLocalReview({task_id:'T1',metrics:{}})"),duplicate=h.run("finishLocalReview({task_id:'T1',metrics:{}})");
  await Promise.all([first,duplicate]);
  assert.equal(h.requests.filter(r=>r.url.includes('/video?')).length,1);
  const evidence=JSON.parse(h.requests.find(r=>r.url.includes('/evidence?')).options.body);
  assert.equal(evidence.calibration_included,true);assert.equal(evidence.geometry[0].target.x,.6);
  assert.equal(evidence.timeline[0].step_id,'T1-R1');assert.equal(h.captureTracks[0].stopped,true);
  assert.equal(h.cameraTrack.stopped,false);assert.equal(h.run('localReviewStatus.hidden'),true);
  h.run("startLocalReview('T3')");await h.run("finishLocalReview({task_id:'T3',metrics:{}})");
  assert.equal(h.requests.filter(r=>r.url.includes('/video?')).length,2);
  assert.equal(h.cameraTrack.stopped,false);
  assert.ok(h.requests.every(r=>!r.options.headers?.['X-User-Id'] && !r.options.headers?.Authorization));
  await h.run('initializeLocalReview()');assert.equal(h.run('localReview.session.session_id'),'session-2');
  assert.equal(h.run('Object.keys(localReview.results).length'),0);
});

test('account mode does not reset local debug files or create an extra recorder',async()=>{
  const h=harness(false);await h.run('initializeLocalReview()');h.run("startLocalReview('T1')");
  assert.equal(await h.run("finishLocalReview({task_id:'T1'})"),null);
  assert.equal(h.requests.length,0);assert.equal(h.captureTracks.length,0);
});

test('debug save errors are reported without a touch-screen prompt or blocking task completion',async()=>{
  const h=harness();await h.run('initializeLocalReview()');h.run("startLocalReview('T1')");h.fail();
  const result=await h.run("finishLocalReview({task_id:'T1'})");assert.equal(result.status,'error');
  assert.equal(h.run('localReview.active'),null);assert.match(h.run('localReviewStatus.textContent'),/save failed/);
  assert.equal(h.cameraTrack.stopped,false);assert.equal(h.captureTracks[0].stopped,true);
});
