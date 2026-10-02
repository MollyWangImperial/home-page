"""Replay real T1 hit detection and holds in the served camera runner."""
import json
import os
import re
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault('MONGO_URL', 'mongodb://127.0.0.1:27017')
os.environ.setdefault('DB_NAME', 'rehyn_reach_activation_test')
from backend import server
from backend.tests.test_ladder_lap_start_runtime import REPLAY, SETUP


REACH_REPLAY = REPLAY[:REPLAY.index('async function main(){')] + r'''
function target(){return JSON.parse(run('JSON.stringify(targetCanvasPoint(getCurrentStep(),getEffectiveTargetXY(getCurrentStep())))'));}
function raiseHand(){
  const point=target();
  for(const index of input.side==='left'?[15,17,19,21]:[16,18,20,22])
    pose[index]={...point,z:0,visibility:1,presence:1};
}
function activeFrame(){frame();run('loop();');}
async function main(){
  run('drawingUtils={drawConnectors(){},drawLandmarks(){}};');
  frames();assert.equal(run('lapTargetCalibration.ready'),true);
  const completing=run('completePreAssessmentCalibration()');
  sandbox.finishVoice();timers.shift()();await settle();
  assert.equal(run('ladderFlow.taskId'),'T1');
  const originalLap=lap(),firstTarget=target();
  const allTargets=JSON.parse(run('JSON.stringify(forwardReachPlacement.rungTargets)'));
  const radius=run('getCurrentStep().ladderRadius'),aspect=run('video.videoWidth/video.videoHeight');
  for(const [a,b] of [['r80','r120'],['r120','r160'],['r80','r160']])
    assert.ok(run(`forwardReachDistance(forwardReachPlacement.rungTargets.${a},forwardReachPlacement.rungTargets.${b})`)>radius*2,
      'The large circle boundaries must never overlap at any pair of heights');
  if(input.raise_timing==='during_voice'){
    raiseHand();for(let i=0;i<15;i++)activeFrame();
    assert.equal(run('stepCompleted'),false,'Speech must finish before a hold can count');
  }
  sandbox.finishVoice();await completing;await settle();
  if(input.raise_timing==='just_after_voice')raiseHand();
  activeFrame();activeFrame();
  assert.equal(run('stepCompleted'),false,'Keep the 350 ms voice settling window');
  if(input.raise_timing==='after_arming'){
    activeFrame();activeFrame();
    assert.equal(run('assessmentLapTargetLocked'),true);raiseHand();
  }
  for(let i=0;i<20 && !run('stepCompleted');i++)activeFrame();
  assert.equal(run('assessmentLapTargetLocked'),true,'Raising a hand must not strand the lap start gate');
  assert.deepEqual(lap(),originalLap,'The lifted wrist must not replace the calibrated lap');
  assert.deepEqual(target(),firstTarget,'The visible circle stays fixed during the reach');
  assert.equal(run('stepCompleted'),true,'A hand inside the displayed first circle completes its real hold');
  assert.ok(!sandbox.spoken.some(text=>text==='Keep your affected hand resting on your lap for a moment.'),
    'Starting the requested reach is not a reason to ask the patient to put the hand back');
  assert.equal(messages.filter(m=>m.type==='assessment_lap_target_locked').length,1);
  timers.shift()();await settle();
  assert.equal(run('ladderFlow.engine.attempts.length'),1);
  assert.equal(run('ladderFlow.engine.attempts[0].completed'),true);
  assert.equal(run('ladderFlow.engine.rung'),'r120');
  assert.notDeepEqual(target(),firstTarget);
  for(const rung of ['r120','r160']){
    const higher=target();
    for(let i=0;i<5;i++)activeFrame();assert.equal(run('stepCompleted'),false);
    sandbox.finishVoice();await settle();
    for(let i=0;i<18;i++)activeFrame();
    assert.equal(run('stepCompleted'),false,'Holding at the previous circle cannot activate the higher circle');
    // Even a fingertip that already lies in the new circle needs a new wrist lift.
    for(const index of input.side==='left'?[17,19,21]:[18,20,22])pose[index]={...higher,visibility:1};
    for(let i=0;i<18;i++)activeFrame();
    assert.equal(run('stepCompleted'),false,'Stationary wrist cannot bypass the ascent with another contact point');
    raiseHand();
    for(let i=0;i<20 && !run('stepCompleted');i++)activeFrame();
    assert.equal(run('stepCompleted'),true,'Each higher circle also activates and completes');
    assert.equal(run('targetCompletion.radius'),run('ladderFlow.step.ladderRadius'));
    assert.deepEqual(target(),higher);assert.deepEqual(lap(),originalLap);
    timers.shift()();await settle();
  }
  assert.equal(run('ladderFlow.engine.attempts.length'),3);
  assert.equal(run('ladderFlow.returning'),true);
  assert.deepEqual(target(),originalLap);
  console.log('Served T1: 80%, 120%, 160% holds complete and return to the original lap');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
'''


NEGATIVE_REPLAY = REACH_REPLAY[:REACH_REPLAY.index('async function main(){')] + r'''
async function main(){
  run('drawingUtils={drawConnectors(){},drawLandmarks(){}};');
  frames();assert.equal(run('lapTargetCalibration.ready'),true);
  const completing=run('completePreAssessmentCalibration()');
  sandbox.finishVoice();timers.shift()();await settle();
  const originalLap=lap(),point=target();
  const otherIndices=input.side==='left'?[16,18,20,22]:[15,17,19,21];
  const affectedIndices=input.side==='left'?[15,17,19,21]:[16,18,20,22];
  for(const index of affectedIndices)pose[index]={...originalLap,visibility:1};
  for(const index of otherIndices)pose[index]={x:.9,y:.85,visibility:1};
  if(input.condition==='wrong_hand')for(const index of otherIndices)pose[index]={...point,visibility:1};
  else{
    raiseHand();
    if(input.condition==='outside_ring'){
      const offset=run('effectiveRadius(getCurrentStep(),pose)*1.15/Math.max(video.videoWidth/video.videoHeight,1)');
      for(const index of affectedIndices)pose[index].x+=offset;
    }
    if(input.condition==='shoulder_compensation')for(const index of [11,12]){pose[index].x-=.06;pose[index].y-=.06;}
  }
  for(let i=0;i<10;i++)activeFrame();
  assert.equal(run('stepCompleted'),false,'No hold counts during speech');
  sandbox.finishVoice();await completing;await settle();
  for(let i=0;i<20;i++){
    if(input.condition==='stale_pose'){
      now+=100;run('lastPoseScanTs=performance.now()-500;loop();');
    }else activeFrame();
  }
  assert.equal(run('stepCompleted'),input.condition==='shoulder_compensation',
    'Only a fresh affected hand inside the circle activates; compensation does not block collection');
  if(!run('stepCompleted')){
    for(const index of otherIndices)pose[index]={x:.9,y:.85,visibility:1};
    raiseHand();for(let i=0;i<20 && !run('stepCompleted');i++)activeFrame();
    assert.equal(run('stepCompleted'),true,'Valid hand contact recovers without restarting');
  }
  assert.deepEqual(lap(),originalLap);
  console.log('Wrong hand, outside ring and stale frames rejected; valid contact and compensation permitted');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
'''


@pytest.mark.parametrize('side', ['left', 'right'])
@pytest.mark.parametrize('raise_timing', ['during_voice', 'just_after_voice', 'after_arming'])
@pytest.mark.parametrize('camera', ['landscape', 'portrait'])
def test_first_reach_activates_when_the_hand_is_lifted_around_the_cue(side, raise_timing, camera):
    run_replay(side, REACH_REPLAY, camera, raise_timing=raise_timing)


STABILITY_REPLAY = REACH_REPLAY[:REACH_REPLAY.index('async function main(){')] + r'''
async function main(){
  run('drawingUtils={drawConnectors(){},drawLandmarks(){}};');
  frames();assert.equal(run('lapTargetCalibration.ready'),true);
  const completing=run('completePreAssessmentCalibration()');
  sandbox.finishVoice();timers.shift()();await settle();
  const first=target(),radius=run('getCurrentStep().ladderRadius');
  const shoulders=[{...pose[11]},{...pose[12]}];
  for(let i=0;i<50;i++){
    const d=i%2?.002:-.002;
    for(let j=0;j<2;j++)pose[11+j]={...shoulders[j],x:shoulders[j].x+d*(j?1:-1),y:shoulders[j].y+d};
    activeFrame();
    assert.deepEqual(target(),first,'Small shoulder noise must not shake the visible circle');
    assert.equal(run('getCurrentStep().ladderRadius'),radius,'Noise must not resize the hit boundary');
  }
  pose[11]={...shoulders[0]};pose[12]={...shoulders[1]};
  const oldLap=lap();shift(.025);frames(25);
  const moved=target();assert.notDeepEqual(moved,first,'A genuine seated adjustment still refreshes geometry during speech');
  assert.ok(Math.abs(lap().x-oldLap.x-.025)<1e-9);
  sandbox.finishVoice();await completing;await settle();
  raiseHand();for(let i=0;i<25 && !run('stepCompleted');i++)activeFrame();
  assert.equal(run('stepCompleted'),true);
  assert.deepEqual(target(),moved,'The movement keeps its final geometry');
  console.log('Small shoulder noise filtered; real pre-movement lap updates and target activation preserved');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
'''


@pytest.mark.parametrize('side', ['left', 'right'])
@pytest.mark.parametrize('camera', ['landscape', 'portrait'])
def test_reach_circle_stays_still_under_tracking_noise(side, camera):
    run_replay(side, STABILITY_REPLAY, camera)


@pytest.mark.parametrize('side', ['left', 'right'])
@pytest.mark.parametrize('condition', ['wrong_hand', 'outside_ring', 'stale_pose', 'shoulder_compensation'])
def test_reach_contact_requires_the_displayed_circle_and_fresh_affected_hand(side, condition):
    run_replay(side, NEGATIVE_REPLAY, 'landscape', condition=condition)


def run_replay(side, replay, camera, **options):
    response = TestClient(server.app).get('/api/pose/runner?ladder=1&task_ids=T1&local_preview=1')
    assert response.status_code == 200
    html = response.text
    start = html.index('const API_BASE =')
    setup = SETUP.replace('sandbox.window=sandbox;', 'sandbox.window=sandbox;sandbox.spoken=[];').replace(
        'getBoundingClientRect:()=>({width:640,height:480})',
        'getBoundingClientRect:()=>({left:0,top:0,right:640,bottom:480,width:640,height:480})',
    ).replace('&helper=0&affected_side=', '&helper=0&start_rung=r80&affected_side=')
    if camera == 'portrait':
        replay = replay.replace('video.videoWidth=640;video.videoHeight=480;', 'video.videoWidth=480;video.videoHeight=640;')
        replay = replay.replace('[11,.4,.40],[12,.6,.40]', '[11,.4,.46],[12,.6,.46]')
        replay = replay.replace('sandbox.pose=pose;', 'pose.forEach(p=>p.x+=.12);sandbox.pose=pose;')
    result = subprocess.run([shutil.which('node'), '-e', setup + replay], input=json.dumps({
        'script': html[start:html.index('</script>', start)],
        'support': re.findall(r'<script>(.*?)</script>', html[:start], re.S),
        'tasks': [next(task for task in server.TASKS_DATA if task['id'] == 'T1')],
        'side': side, **options,
    }), text=True, capture_output=True, encoding='utf-8', timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
