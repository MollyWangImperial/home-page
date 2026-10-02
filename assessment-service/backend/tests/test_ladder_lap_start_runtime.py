"""Replay the served runner across calibration speech and the first task cue."""
import json
import os
import re
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault('MONGO_URL', 'mongodb://127.0.0.1:27017')
os.environ.setdefault('DB_NAME', 'rehyn_ladder_lap_start_test')
from backend import server
from backend.tests.test_hand_ladder_runtime import SETUP


REPLAY = r'''
sandbox.taskData=input.tasks;
run(`tasks=taskData;currentTaskIdx=0;running=true;calibratingAssessment=true;
  video.videoWidth=640;video.videoHeight=480;
  assessmentLapTargetLocked=false;lapTargetCalibration=newLapTargetCalibration();
  preAssessmentCalibrationReady=true;calibrationInstructionFinished=true;
  finalizePatientFaceReference=()=>{};
  beginTaskRecording=()=>{};startLocalReview=()=>{};markLocalReviewStep=()=>{};
  prefetchVoice=()=>{};
  playVoice=text=>{window.spoken.push(text);return new Promise(resolve=>window.finishVoice=resolve);};
`);
const pose=Array.from({length:33},()=>({x:.5,y:.3,z:0,visibility:1}));
for(const [i,x,y] of [[0,.5,.18],[9,.48,.25],[10,.52,.25],[11,.4,.40],[12,.6,.40],
  [13,.4,.5],[14,.6,.5],[15,.43,.76],[16,.57,.76],[23,.43,.7],[24,.57,.7]])
  Object.assign(pose[i],{x,y});
if(input.side==='left')pose.forEach(p=>p.x+=.20); // Reserve room for the separated reach circles.
sandbox.pose=pose;
const wrist=input.side==='left'?15:16;
function frame(){now+=100;run('latestPoseLandmarks=pose;lastPoseScanTs=performance.now();updateLapTargetCalibration(pose,performance.now());');}
function frames(count=20){for(let i=0;i<count;i++)frame();}
function shift(dx){pose.forEach(p=>p.x+=dx);}
function lap(){return JSON.parse(run('JSON.stringify(assessmentLapTarget)'));}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
async function main(){
  frames();assert.equal(run('lapTargetCalibration.ready'),true);
  const first=pose[wrist].x;
  const completing=run('completePreAssessmentCalibration()');
  shift(.06);frames();
  assert.equal(run('lapTargetCalibration.ready'),true);
  assert.ok(Math.abs(run('lapTargetCalibration.target.x')-(first+.06))<1e-9);
  assert.equal(run('assessmentLapTargetLocked'),false);
  sandbox.finishVoice();timers.shift()();await settle();
  assert.equal(run('calibratingAssessment'),false);
  assert.equal(run('voiceFinishedAt'),0);
  assert.equal(run('ladderFlow.taskId'),'T1');
  const initialReach=JSON.parse(run('JSON.stringify(ladderFlow.step.ladderTarget)'));
  // Another stable seated adjustment while the first movement cue is playing.
  shift(.025);frames();
  assert.ok(Math.abs(lap().x-(first+.085))<1e-9);
  const latestReach=JSON.parse(run('JSON.stringify(ladderFlow.step.ladderTarget)'));
  assert.notDeepEqual(latestReach,initialReach,'Reach geometry follows the refreshed lap too');
  assert.equal(run('ladderContact(pose,performance.now())'),false);
  assert.equal(run('assessmentLapTargetLocked'),false);
  sandbox.finishVoice();await completing;
  frame();frame();run('ladderContact(pose,performance.now())');
  assert.equal(run('assessmentLapTargetLocked'),false,'Keep tracking during the voice settling window');
  let expectedX=first+.085;
  if(input.reframe_late){
    shift(.06);frame();frame();run('ladderContact(pose,performance.now())');
    assert.equal(run('assessmentLapTargetLocked'),false,'Do not arm a displaced lap at the start gate');
    assert.match(run('captionEl.textContent'),/resting on your lap/);
    sandbox.finishVoice();await settle();
    frames();run('ladderContact(pose,performance.now())');await settle();
    assert.equal(run('voiceFinishedAt'),0,'Replay the movement cue after the new lap settles');
    assert.equal(run('assessmentLapTargetLocked'),false);
    sandbox.finishVoice();await settle();expectedX+=.06;
    frame();frame();
  }
  frame();frame();run('ladderContact(pose,performance.now())');
  assert.equal(run('assessmentLapTargetLocked'),true);
  const locked=lap(),radius=run('assessmentLapTargetRadius');
  assert.ok(Math.abs(locked.x-expectedX)<1e-9);
  assert.deepEqual(JSON.parse(run('JSON.stringify(ladderFlow.rest)')),locked);
  assert.equal(messages.filter(m=>m.type==='assessment_lap_target_locked').length,1);
  shift(-.12);frames(30);
  assert.deepEqual(lap(),locked,'Assessment motion must never resample the lap');
  assert.equal(run('assessmentLapTargetRadius'),radius);
  run('currentTaskIdx=1;currentStepIdx=0;');const next=run('startStep()');
  frames();assert.deepEqual(lap(),locked,'The next task inherits the same final reference');
  sandbox.finishVoice();await next;
  console.log('Lap refreshes through calibration and first task speech, then locks once across tasks');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
'''


@pytest.mark.parametrize('side', ['left', 'right'])
@pytest.mark.parametrize('reframe_late', [False, True])
def test_lap_reference_locks_when_the_first_movement_is_armed(side, reframe_late):
    response = TestClient(server.app).get('/api/pose/runner?ladder=1&task_ids=T1,T3&local_preview=1')
    assert response.status_code == 200
    html = response.text
    start = html.index('const API_BASE =')
    setup = SETUP.replace('sandbox.window=sandbox;', 'sandbox.window=sandbox;sandbox.spoken=[];').replace(
        'getBoundingClientRect:()=>({width:640,height:480})',
        'getBoundingClientRect:()=>({left:0,top:0,right:640,bottom:480,width:640,height:480})',
    )
    result = subprocess.run([shutil.which('node'), '-e', setup + REPLAY], input=json.dumps({
        'script': html[start:html.index('</script>', start)],
        'support': re.findall(r'<script>(.*?)</script>', html[:start], re.S),
        'tasks': [next(task for task in server.TASKS_DATA if task['id'] == tid) for tid in ['T1','T3']],
        'side': side, 'reframe_late': reframe_late,
    }), text=True, capture_output=True, encoding='utf-8', timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
