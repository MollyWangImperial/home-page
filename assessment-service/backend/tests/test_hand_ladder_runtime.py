"""Replay the served camera runner with synthetic frames, not patient video."""
import json
import os
import re
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient
os.environ.setdefault('MONGO_URL', 'mongodb://127.0.0.1:27017')
os.environ.setdefault('DB_NAME', 'rehyn_hand_ladder_test')
from backend import server
from backend.tests.test_hand_first_open_runtime import HARNESS


SETUP = HARNESS.split('sandbox.taskData=input.tasks;')[0].replace(
    '?package=initial&local_preview=1&affected_side=',
    '?package=initial&local_preview=1&ladder=1&helper=0&affected_side=',
)
REPLAY = r'''
sandbox.taskData=input.tasks;
run(`tasks=taskData; currentTaskIdx=0; running=true; calibratingAssessment=false;
  video.videoWidth=window.frameWidth;video.videoHeight=480;
  stage.getBoundingClientRect=()=>({left:0,top:0,width:640,height:480});
  cameraFrame.getBoundingClientRect=()=>({left:0,top:0,width:640,height:480});
  assessmentLapTarget={x:.62,y:.80};assessmentLapTargetRadius=.1;
  lapTargetCalibration={target:assessmentLapTarget,ready:true};
  drawingUtils={drawConnectors(){},drawLandmarks(){}};
  beginTaskRecording=()=>{};startLocalReview=()=>{};markLocalReviewStep=()=>{};
  stopAndSaveTaskRecording=()=>{};finishLocalReview=async()=>{};persistTaskProgress=()=>{};
  finishAssessment=async()=>{window.finished=true;};
  playVoice=text=>{window.spoken.push(text);return new Promise(resolve=>window.finishVoice=resolve);};
  prefetchVoice=()=>{};
  const drawCircle=RehynReachTarget.drawTestingTarget;
  RehynReachTarget.drawTestingTarget=(ctx,options)=>{window.drawn=options;drawCircle(ctx,options);};
`);
const pose=Array.from({length:33},()=>({x:.15,y:.82,z:0,visibility:1,presence:1}));
pose[0]={x:.47,y:.25,visibility:1};
pose[9]={x:.445,y:.3,visibility:1};pose[10]={x:.495,y:.3,visibility:1};
pose[11]={x:.35,y:.5,visibility:1};pose[12]={x:.65,y:.5,visibility:1};
const wrist=input.side==='left'?15:16,finger=input.side==='left'?19:20,other=input.side==='left'?16:15;
sandbox.pose=pose;sandbox.hand=null;
function frame(ms=100){now+=ms;run(`latestPoseLandmarks=pose;lastPoseScanTs=performance.now();
  latestHandLandmarks=hand;latestHandSeenAt=hand?performance.now():0;loop();`);}
async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}
async function voice(){sandbox.finishVoice();await settle();frame(200);assert.equal(run('stepCompleted'),false);frame(200);}
async function finishHold(){for(let i=0;i<20 && !run('stepCompleted');i++)frame();
  assert.equal(run('stepCompleted'),true);assert.ok(timers.length);timers.shift()();await settle();}
function target(){return JSON.parse(run('JSON.stringify(targetCanvasPoint(getCurrentStep(),getEffectiveTargetXY(getCurrentStep())))'));}
async function main(){
  frame(); // Fresh body framing exists from the seated calibration before H4.
  const starting=run('startStep()');const ready=target();
  const initialRadius=run('getCurrentStep().ladderRadius');
  pose[wrist]={...ready,visibility:1};
  for(let i=0;i<8;i++)frame();
  assert.equal(run('ladderFlow.handStage'),'initial');assert.equal(run('stepCompleted'),false);
  await voice();await starting;await finishHold();
  assert.equal(run('ladderFlow.handStage'),'palm');
  const opening=target();assert.ok(Math.abs(opening.x-(input.side==='left'?.425:.575))<1e-9);
  assert.deepEqual(opening,ready,'Palm orientation stays at the starting circle');
  assert.equal(run('getCurrentStep().ladderRadius'),initialRadius);
  assert.ok(opening.y>.6 && opening.y<.7,'The whole circle and upright fingers leave the face clear');
  pose[wrist]={x:opening.x,y:opening.y+.08,visibility:1};pose[finger]={...opening,visibility:1};
  // A visibly open hand centered at the raised hand circle.
  const open=Array.from({length:21},()=>({x:opening.x,y:opening.y,z:0}));
  open[0]={x:opening.x,y:opening.y+.08,z:0};
  for(const [base,dx,dy] of [[5,-.045,-.04],[9,-.015,-.055],[13,.02,-.045],[17,.045,-.04]])
    for(let j=0;j<4;j++)open[base+j]={x:opening.x+dx,y:opening.y+dy-j*.048,z:0};
  for(let i=1;i<=4;i++)open[i]={x:opening.x-.01-i*.027,y:opening.y+.04-i*.025,z:0};
  if(input.side==='right')open.forEach(p=>p.x=opening.x*2-p.x);
  if(input.projection==='perspective')open.forEach(p=>{p.z=(p.x-opening.x)*.16;p.x=opening.x+(p.x-opening.x)*.8;});
  assert.ok(Math.min(...open.map(p=>p.y))>.3,'The open fingers leave mouth and nose visible');
  const edge=open.map(p=>({...p,x:opening.x+(p.x-opening.x)*.08,z:(p.x-opening.x)*1.2}));
  sandbox.hand=edge;await voice();
  for(let i=0;i<15;i++)frame();
  assert.equal(run('stepCompleted'),false,'Edge-on palm cannot finish the orientation circle');
  assert.equal(sandbox.drawn.x,opening.x*640);assert.equal(sandbox.drawn.y,opening.y*480);
  const atFace=open.map(p=>({...p,x:p.x+(.47-opening.x),y:p.y+(.3-opening.y)}));
  sandbox.hand=atFace;
  for(let i=0;i<15;i++)frame();
  assert.equal(run('stepCompleted'),false,'A palm over the face cannot complete the chest target');
  sandbox.hand=open;await finishHold();
  assert.equal(run('ladderFlow.handStage'),'gesture');assert.deepEqual(target(),opening);
  assert.equal(run('getCurrentStep().ladderRadius'),initialRadius);
  pose[9].y+=.05;pose[10].y+=.05;pose[11].x+=.015;pose[12].x-=.015;
  frame();assert.deepEqual(target(),opening,'Face and shoulder noise cannot move the opening target');
  // Turning back to edge-on fails even with a high opening score from before.
  sandbox.hand=edge;await voice();
  for(let i=0;i<15;i++)frame();assert.equal(run('stepCompleted'),false);
  // Fingers curled back towards their bases, with the palm still broadside.
  const curled=open.map(p=>({...p}));
  for(const base of [5,9,13,17]){
    curled[base+1]={...open[base],y:open[base].y-.035};
    curled[base+2]={...open[base],y:open[base].y-.005};
    curled[base+3]={...open[base],y:open[base].y+.03};
  }
  sandbox.hand=curled;
  for(let i=0;i<15;i++)frame();assert.ok(run('handOpenScore')<.65);
  assert.equal(run('stepCompleted'),false,'A broadside palm with curled fingers is not enough opening');
  sandbox.hand=open;
  await finishHold();assert.ok(run('handOpenScore')>=.65);
  assert.equal(run('ladderFlow.handStage'),'lap');assert.deepEqual(target(),{x:.62,y:.8});
  const snapshot=JSON.parse(run('JSON.stringify(ladderFlow.engine.snapshot())'));
  assert.equal(snapshot.attempts.length,1);assert.equal(snapshot.best_alone,'full');
  assert.equal(snapshot.protocol,'hand_open_at_chest_v2');
  sandbox.hand=null;pose[other]={x:.62,y:.8,visibility:1};await voice();
  for(let i=0;i<15;i++)frame();assert.equal(run('stepCompleted'),false,'The other hand cannot finish the lap stage');
  pose[wrist]={x:.62,y:.8,visibility:1};await finishHold();
  assert.equal(run('taskResults[0].completed_steps'),1,'Only the hand action is scored');
  assert.equal(run('taskTransitionPending'),true);
  assert.equal(run('celebrateEl.classList.contains("hidden")'),false);
  assert.equal(sandbox.spoken.length,4);
  assert.ok(sandbox.spoken.every(text=>!/mouth/i.test(text)),'Hand opening uses hand-circle wording');
  assert.match(sandbox.spoken[1],/Keep your hand at the same circle/);
  console.log('Served H4: raise -> face palm -> open at one fixed circle -> original lap; face clearance and voice gates passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
'''


@pytest.mark.parametrize('side', ['left', 'right'])
@pytest.mark.parametrize('projection', ['front','perspective'])
def test_served_open_hand_sequence(side, projection):
    response = TestClient(server.app).get('/api/pose/runner?ladder=1&task_ids=H4&local_preview=1')
    assert response.status_code == 200 and response.headers['content-type'].startswith('text/html')
    html = response.text
    start = html.index('const API_BASE =')
    script = html[start:html.index('</script>', start)]
    setup = SETUP.replace('sandbox.window=sandbox;', 'sandbox.window=sandbox;sandbox.spoken=[];sandbox.frameWidth=640;')
    result = subprocess.run([shutil.which('node'), '-e', setup + REPLAY], input=json.dumps({
        'script': script, 'support': re.findall(r'<script>(.*?)</script>', html[:start], re.S),
        'tasks': [next(task for task in server.HAND_TASKS_DATA if task['id'] == 'H4')], 'side': side, 'projection':projection,
    }), text=True, capture_output=True, encoding='utf-8', timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr


MOUTH_REPLAY = REPLAY[:REPLAY.index('async function main(){')] + r'''
async function main(){
  const starting=run('startStep()'),middle=target();
  assert.deepEqual(middle,{x:.5,y:.5});
  pose[other]={...middle,visibility:1};await voice();await starting;
  for(let i=0;i<15;i++)frame();assert.equal(run('stepCompleted'),false);
  pose[9].x+=.02;pose[10].x+=.02;pose[9].y+=.04;pose[10].y+=.04;
  pose[wrist]={...middle,visibility:1};await finishHold();
  pose[other]={x:.1,y:.85,visibility:1};
  assert.equal(run('ladderFlow.handStage'),'gesture');
  assert.equal(run('ladderFlow.engine.attempts.length'),0);
  const mouth=target();assert.ok(Math.abs(mouth.x-.49)<1e-9);assert.ok(Math.abs(mouth.y-.34)<1e-9);
  pose[9].y+=.10;pose[10].y+=.10;
  pose[wrist]={x:mouth.x,y:mouth.y+.2,visibility:1};pose[finger]={...mouth,visibility:1};
  for(let i=0;i<12;i++)frame();assert.equal(run('stepCompleted'),false);assert.deepEqual(target(),mouth,'The testing mouth target stays fixed once it appears');
  await voice();await finishHold();
  assert.equal(run('ladderFlow.returning'),true);
  assert.deepEqual(target(),{x:.62,y:.8});
  const snapshot=JSON.parse(run('JSON.stringify(ladderFlow.engine.snapshot())'));
  assert.equal(snapshot.attempts.length,1);assert.equal(snapshot.best_alone,'mouth');
  assert.match(sandbox.spoken[0],/starting circle/);
  assert.match(sandbox.spoken[1],/From the starting circle.*mouth/);
  console.log('Served T3: middle initialization -> fixed mouth -> original lap; only mouth action scored');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
'''


@pytest.mark.parametrize('side', ['left', 'right'])
def test_served_mouth_sequence_starts_at_the_middle(side):
    response = TestClient(server.app).get('/api/pose/runner?ladder=1&task_ids=T3&local_preview=1')
    assert response.status_code == 200
    html = response.text
    start = html.index('const API_BASE =')
    setup = SETUP.replace('sandbox.window=sandbox;', 'sandbox.window=sandbox;sandbox.spoken=[];sandbox.frameWidth=640;')
    result = subprocess.run([shutil.which('node'), '-e', setup + MOUTH_REPLAY], input=json.dumps({
        'script': html[start:html.index('</script>', start)],
        'support': re.findall(r'<script>(.*?)</script>', html[:start], re.S),
        'tasks': [next(task for task in server.TASKS_DATA if task['id'] == 'T3')], 'side': side,
    }), text=True, capture_output=True, encoding='utf-8', timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr


PINCH_REPLAY = REPLAY[:REPLAY.index('async function main(){')] + r'''
async function main(){
  pose[9].visibility=0;pose[10].visibility=0; // A pinch-only task does not need mouth calibration.
  const pinched=Array.from({length:21},()=>({x:.5,y:.43,z:0}));
  pinched[0]={x:.5,y:.53,z:0};
  for(const [index,x] of [[5,.455],[9,.485],[13,.52],[17,.545]])pinched[index]={x,y:.455,z:0};
  pinched[4]={x:.49,y:.43,z:0};pinched[8]={x:.491,y:.43,z:0};
  sandbox.hand=pinched;
  const starting=run('startStep()'),ready=target();
  assert.deepEqual(ready,{x:.5,y:.5});
  assert.equal(run('getCurrentStep().target.icon'),undefined,'The coin must not appear before the starting circle');
  pose[other]={...ready,visibility:1};await voice();await starting;
  for(let i=0;i<15;i++)frame();
  assert.equal(run('stepCompleted'),false,'The other wrist or a pinch cannot bypass initialization');
  assert.equal(run('ladderFlow.engine.attempts.length'),0);
  assert.equal(run('ladderFlow.engine.snapshot().measured'),false);
  pose[wrist]={...ready,visibility:1};await finishHold();
  assert.equal(run('ladderFlow.handStage'),'gesture');
  const coin=target();assert.deepEqual(coin,{x:.5,y:.43});
  assert.equal(run('getCurrentStep().target.icon'),'coin');
  assert.equal(run('ladderFlow.engine.attempts.length'),0,'Starting circle is preparation, not a pinch score');
  for(let i=0;i<10;i++)frame();assert.equal(run('stepCompleted'),false,'Pinch instruction must finish first');
  await voice();assert.ok(run('pinchScore')>=.8);
  await finishHold();assert.equal(run('ladderFlow.returning'),true);
  assert.deepEqual(target(),{x:.62,y:.8});
  const snapshot=JSON.parse(run('JSON.stringify(ladderFlow.engine.snapshot())'));
  assert.equal(snapshot.attempts.length,1);assert.equal(snapshot.best_alone,'full');
  sandbox.hand=null;pose[wrist]={x:.62,y:.8,visibility:1};await voice();await finishHold();
  assert.equal(run('taskResults[0].completed_steps'),1);
  assert.match(sandbox.spoken[0],/starting circle/);
  assert.match(sandbox.spoken[1],/thumb.*index finger.*pinch/);
  assert.match(sandbox.spoken[2],/rest back on your lap/);
  console.log('Served H3: starting circle -> pinch coin -> original lap; initialization never scores');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
'''


@pytest.mark.parametrize('side', ['left', 'right'])
def test_served_pinch_starts_with_an_unscored_circle(side):
    response = TestClient(server.app).get('/api/pose/runner?ladder=1&task_ids=H3&local_preview=1')
    assert response.status_code == 200
    html = response.text
    start = html.index('const API_BASE =')
    setup = SETUP.replace('sandbox.window=sandbox;', 'sandbox.window=sandbox;sandbox.spoken=[];sandbox.frameWidth=640;')
    result = subprocess.run([shutil.which('node'), '-e', setup + PINCH_REPLAY], input=json.dumps({
        'script': html[start:html.index('</script>', start)],
        'support': re.findall(r'<script>(.*?)</script>', html[:start], re.S),
        'tasks': [next(task for task in server.HAND_TASKS_DATA if task['id'] == 'H3')], 'side': side,
    }), text=True, capture_output=True, encoding='utf-8', timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
