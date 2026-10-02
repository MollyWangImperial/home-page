"""Regression replay for ordinary lap framing after changes to reach circles."""
import json
import os
import re
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault('MONGO_URL','mongodb://127.0.0.1:27017')
os.environ.setdefault('DB_NAME','rehyn_lap_calibration_regression')
from backend import server
from backend.tests.test_ladder_lap_start_runtime import REPLAY, SETUP


CALIBRATION = REPLAY[:REPLAY.index('async function main(){')].replace(
    "if(input.side==='left')pose.forEach(p=>p.x+=.20);", "// Ordinary centered framing, for either affected side."
) + r'''
for(const id of ['calibrationCamera','calibrationArm','calibrationSeat','calibrationLap'])
  element(id).querySelector=()=>element(id+'Dot');
run(`video.readyState=4;video.videoWidth=${input.width};video.videoHeight=${input.height};
  preAssessmentCalibrationReady=false;calibrationInstructionFinished=false;`);
if(input.blocked){
  pose[11].y=pose[12].y=.3;pose[15].y=pose[16].y=.86;pose[23].y=pose[24].y=.80;
}
const other=input.side==='left'?16:15;
if(input.wrong_hand){pose[wrist].y=.24;pose[other].y=.76;}
let locatedAt=null;
for(let i=0;i<22;i++){
  const p={...pose[wrist]};if(i===5 && !input.wrong_hand)pose[wrist].x+=.1;
  frame();pose[wrist]=p;
  run('updatePreAssessmentCalibrationUI(pose);');
  if(locatedAt===null && run('lapTargetCalibration.ready'))locatedAt=(i+1)*100;
}
if(input.wrong_hand){
  assert.equal(locatedAt,null);assert.equal(run('lapTargetCalibration.ready'),false);
  assert.equal(run('lapCalibrationDiagnostic.reason'),'wrong_hand_on_lap');
  assert.match(run('calibrationTitle.textContent'),/other hand.*lap/i,'The correction must be visible in the main calibration heading');
}else{
  assert.ok(locatedAt!==null && locatedAt<=1200,'A stable lap must be located promptly in ordinary framing');
  assert.equal(messages.filter(m=>m.type==='lap_target_calibrated').length,1);
  assert.ok(Math.abs(run('lapTargetCalibration.target.x')-pose[wrist].x)<1e-8);
  const status=JSON.parse(run('JSON.stringify(calibrationLandmarkStatus(pose))'));
  assert.equal(status.lapReady,true);
  if(input.blocked){
    assert.equal(run('forwardReachPlacement.ready'),false);
    assert.equal(status.reachReady,false);assert.equal(status.ready,false);
    assert.match(run('calibrationTitle.textContent'),/Lap located.*camera/i);
    assert.equal(run('preAssessmentCalibrationReady'),false,'Do not silently lower or clip the requested high target');
  }else{
    assert.equal(run('forwardReachPlacement.ready'),true);
    assert.equal(status.reachReady,true);assert.equal(status.ready,true);
    const targets=JSON.parse(run('JSON.stringify(forwardReachPlacement.rungTargets)'));
    const radius=run('forwardReachPlacement.radius');
    for(const [a,b] of [['r80','r120'],['r120','r160'],['r80','r160']])
      assert.ok(run(`forwardReachDistance(forwardReachPlacement.rungTargets.${a},forwardReachPlacement.rungTargets.${b})`)>radius*2);
  }
}
console.log('Lap framing, specific corrections and separated large targets passed');
'''


@pytest.mark.parametrize('side', ['left','right'])
@pytest.mark.parametrize('width,height', [(640,480),(640,360),(480,640)])
@pytest.mark.parametrize('condition', ['normal','blocked','wrong_hand'])
def test_lap_locates_independently_of_reach_layout(side,width,height,condition):
    response=TestClient(server.app).get('/api/pose/runner?ladder=1&task_ids=T1,T3&local_preview=1')
    assert response.status_code==200 and response.headers['content-type'].startswith('text/html')
    html=response.text;start=html.index('const API_BASE =')
    setup=SETUP.replace('sandbox.window=sandbox;', 'sandbox.window=sandbox;sandbox.spoken=[];').replace(
        'getBoundingClientRect:()=>({width:640,height:480})',
        f'getBoundingClientRect:()=>({{left:0,top:0,right:{width},bottom:{height},width:{width},height:{height}}})',
    )
    result=subprocess.run([shutil.which('node'),'-e',setup+CALIBRATION],input=json.dumps({
        'script':html[start:html.index('</script>',start)],
        'support':re.findall(r'<script>(.*?)</script>',html[:start],re.S),
        'tasks':[next(task for task in server.TASKS_DATA if task['id']==tid) for tid in ['T1','T3']],
        'side':side,'width':width,'height':height,'blocked':condition=='blocked','wrong_hand':condition=='wrong_hand',
    }),text=True,capture_output=True,encoding='utf-8',timeout=30)
    assert result.returncode==0,result.stdout+result.stderr
