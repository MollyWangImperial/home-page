const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {create}=require('../assessment_completion.js');

function fixture(options={}){
  class Element{
    constructor(){this.dataset={};this.style={};this.children=[];this.attributes={};this.hidden=true;this.classList={add:()=>{}};}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(k,v){this.attributes[k]=v;}
    focus(){}
  }
  const nodes={};
  const markup=fs.readFileSync(require.resolve('../assessment_completion_ui.html'),'utf8');
  const ids=new Set(Array.from(markup.matchAll(/\bid="([^"]+)"/g),match=>match[1]));
  const document={body:new Element(),getElementById:id=>ids.has(id)?nodes[id] ||= new Element():null,createElement:()=>new Element()};
  const screen=create({document,minimumMs:0,timeoutMs:100,slowMs:50,...options});
  return {screen,nodes};
}
const data={preview_only:true,task_results:[{task_id:'L6',metrics:{walking_skipped:true}}],metrics:{task_quality:{tasks:[
  {task_id:'T1',label:'Seated Forward Reach',score:85},
  {task_id:'T3',label:'Hand to Mouth',score:null},
  {task_id:'L6',label:'Walking',score:null}
]}}};
const functionData={...data,metrics:{...data.metrics,function_score:{
  version:'rehyn-function-level-1',total:56.3,display_total:56,clinical_measure:false,
  areas:{upper_limb:{score:62.5,partial:false},hand:{score:50,partial:false}},
  tasks:[
    {task_id:'T1',task_label:'Seated reach',level:2,label:'Partly',points:50,next_step:'Next: one circle higher.'},
    {task_id:'T3',task_label:'Hand to mouth',level:3,label:'Can do',points:75,next_step:'Next: the same movement without leaning forward.'},
    {task_id:'H4',task_label:'Hand opening and closing',level:2,label:'Partly',points:50,next_step:'Next: one step further.'},
    {task_id:'H3',task_label:'Pinch',level:2,label:'Partly',points:50,next_step:'Next: one step further.'},
    {task_id:'L6',task_label:'Walking',level:null,label:'Not assessed',points:null,next_step:'Next: adjust the camera and try again.'},
  ],
}}};
const allText=node=>[node.textContent || '',...node.children.map(allText)].join(' ');

test('results retain confirmed coaching without patient-facing diagnostics',async()=>{
  const response=structuredClone(functionData), score=response.metrics.function_score;
  Object.assign(score.tasks[0],{best_alone:'r70',compensations:{trunk_lean:'detected',shoulder_hike:'not_measured'}});
  score.previous_reach={best_alone:'r55'};
  score.daily_activities=[{activity:'Dressing',status:'complete',label:'Partly',limited_by:['H4']},{activity:'Eating and drinking',status:'estimated',label:'Not measured',limited_by:[]}];
  response.task_results=[{task_id:'T1',metrics:{effort:'hard',pain:'no',ladder:{attempts:[{rung:'r70',completed:true,duration_ms:5200,assist:null,angles_from_rest:{arm_elevation:32}}]}}}];
  const {screen,nodes}=fixture();await screen.run(async()=>response);
  assert.equal(nodes.analysisReachTrack,undefined);
  assert.equal(nodes.analysisDailyRows,undefined);
  assert.match(allText(nodes.analysisCoachingRows),/leaned forward/);
  assert.doesNotMatch(allText(nodes.analysisCoachingRows),/lifted your shoulder/);
  assert.equal(nodes.analysisDetails,undefined);
  assert.equal(nodes.analysisDetailsContent,undefined);
});

test('reach and daily-life data cannot recreate removed sections or the preview footer',async()=>{
  const response=structuredClone(functionData),score=response.metrics.function_score;
  Object.assign(score.tasks[0],{best_alone:'r160'});score.previous_reach={best_alone:'r100'};
  score.daily_activities=[{activity:'Dressing',status:'complete',label:'Can do well',limited_by:['T1']}];
  const {screen,nodes}=fixture();await screen.run(async()=>response);
  assert.equal(nodes.assessmentCompletion.dataset.state,'ready');
  assert.equal(nodes.analysisResults.children.length,5);
  for(const id of ['analysisReach','analysisReachTrack','analysisDailyLife','analysisDailyRows','analysisPreviewNote'])assert.equal(nodes[id],undefined);
  const markup=fs.readFileSync(require.resolve('../assessment_completion_ui.html'),'utf8');
  assert.doesNotMatch(markup,/Your reach today|Daily life|Local preview|analysisReach|analysisDaily|analysisPreviewNote/);
});

test('function response shows backend-rounded total, levels, and coaching instead of old scores',async()=>{
  const {screen,nodes}=fixture();
  await screen.run(async()=>functionData);
  assert.equal(nodes.assessmentCompletion.dataset.resultFormat,'function');
  assert.equal(nodes.analysisFunctionSummary.hidden,false);
  assert.equal(nodes.analysisScoreNumber.textContent,'56');
  assert.equal(nodes.analysisScoreUnit.hidden,false);
  const rows=nodes.analysisResults.children;
  assert.equal(rows.length,5);
  assert.equal(rows[0].children[0].children[0].textContent,'Seated reach');
  assert.equal(rows[0].children[0].children[1].textContent,'Partly');
  assert.equal(rows[0].children[1].children.length,5);
  assert.equal(rows[0].children[1].attributes['aria-hidden'],'true');
  assert.equal(rows[0].children[1].children.filter(dot=>dot.className.includes('is-reached')).length,3);
  assert.match(allText(rows[0]),/Next: one circle higher\./);
  assert.match(allText(rows[1]),/without leaning forward/);
  assert.doesNotMatch(allText(rows[0]),/85 \/ 100|50 \/ 100/);
  assert.match(allText(rows[4]),/Not assessed/);
  assert.doesNotMatch(allText(rows[4]),/adjust the camera/);
});

test('zero is a real measured score, while prerequisite-gated pinch has its own label',async()=>{
  const response=structuredClone(functionData);
  response.metrics.function_score.total=0;
  response.metrics.function_score.display_total=0;
  response.metrics.function_score.tasks=[{task_id:'H3',task_label:'Pinch',level:0,points:0,
    label:'Not yet: comes after hand opening',next_step:"We'll start with supported movement."}];
  const {screen,nodes}=fixture();
  await screen.run(async()=>response);
  assert.equal(nodes.analysisScoreNumber.textContent,'0');
  assert.equal(nodes.analysisScoreUnit.hidden,false);
  assert.match(allText(nodes.analysisResults),/Not yet: comes after hand opening/);
  assert.match(allText(nodes.analysisResults),/supported movement/);
});

test('unmeasured evidence shows no total or level dots and never becomes zero',async()=>{
  const response=structuredClone(functionData);
  Object.assign(response.metrics.function_score,{total:null,display_total:null,tasks:[
    {task_id:'T3',task_label:'Hand to mouth',level:null,label:'Not measured',points:null,next_step:'Next: adjust the camera and try again.'}
  ]});
  const {screen,nodes}=fixture();
  await screen.run(async()=>response);
  assert.equal(nodes.analysisScoreNumber.textContent,'—');
  assert.equal(nodes.analysisScoreUnit.hidden,true);
  assert.match(nodes.analysisScoreNote.textContent,/wasn’t enough measured movement/);
  const row=nodes.analysisResults.children[0];
  assert.match(allText(row),/Not measured/);
  assert.equal(row.children.some(child=>child.className==='analysisLevelTrack'),false);
  assert.doesNotMatch(allText(row),/0 \/ 100|Not yet/);
});

test('partial totals and unobserved posture are explained without treating completion as unmeasured',async()=>{
  const response=structuredClone(functionData);
  response.metrics.function_score.areas.upper_limb.partial=true;
  Object.assign(response.metrics.function_score.tasks[1],{
    reason:'full_rung_alone_posture_unobserved',next_step:'Well done—you completed the movement on your own. Your posture wasn’t clear enough to confirm full marks. Next: repeat with your posture clearly in view.',derived:true
  });
  const {screen,nodes}=fixture();
  await screen.run(async()=>response);
  assert.match(nodes.analysisScoreNote.textContent,/Some movements could not be measured/);
  assert.match(allText(nodes.analysisResults.children[1]),/Can do/);
  assert.match(allText(nodes.analysisResults.children[1]),/Well done.*Your posture wasn’t clear enough to confirm full marks/);
  assert.doesNotMatch(allText(nodes.analysisResults.children[1]),/Not measured|derived/);
});

test('walking retains its numeric score and never gets a camera-task level',async()=>{
  const response=structuredClone(functionData);
  response.task_results=[];
  response.metrics.function_score.tasks=[{task_id:'L6',task_label:'Walking',level:null,points:63.7,label:'Walking score',next_step:null}];
  const {screen,nodes}=fixture();
  await screen.run(async()=>response);
  const row=nodes.analysisResults.children[0];
  assert.match(allText(row),/64 \/ 100/);
  assert.equal(row.children.length,1);
});

test('all five level labels and next steps come from the function report',async()=>{
  const response=structuredClone(functionData);
  const labels=['Not yet','Getting started','Partly','Can do','Can do well'];
  response.metrics.function_score.tasks=labels.map((label,level)=>({
    task_id:`task-${level}`,task_label:`Task ${level}`,level,points:level*25,label,next_step:`Next step ${level}.`
  }));
  const {screen,nodes}=fixture();
  await screen.run(async()=>response);
  nodes.analysisResults.children.forEach((row,level)=>{
    assert.equal(row.children[0].children[1].textContent,labels[level]);
    assert.match(allText(row),new RegExp(`Next step ${level}\\.`));
    assert.equal(row.children[1].children.filter(dot=>dot.className.includes('is-reached')).length,level+1);
  });
});

test('unsupported function versions preserve the older score rows',async()=>{
  const response=structuredClone(functionData);
  response.metrics.function_score.version='future-version';
  const {screen,nodes}=fixture();
  await screen.run(async()=>response);
  assert.equal(nodes.assessmentCompletion.dataset.resultFormat,'quality');
  assert.equal(nodes.analysisFunctionSummary.hidden,true);
  assert.equal(nodes.analysisResults.children[0].children[1].textContent,'85 / 100');
});

test('labels and next steps are inserted as text, never HTML',async()=>{
  const response=structuredClone(functionData);
  response.metrics.function_score.tasks[0].task_label='<img src=x onerror=alert(1)>';
  response.metrics.function_score.tasks[0].next_step='<script>example</script>';
  const {screen,nodes}=fixture();
  await screen.run(async()=>response);
  const row=nodes.analysisResults.children[0];
  assert.equal(row.children[0].children[0].textContent,'<img src=x onerror=alert(1)>');
  assert.equal(row.children[2].textContent,'<script>example</script>');
  assert.equal(row.children[2].innerHTML,undefined);
});

test('empty preview results never claim that a record was saved',async()=>{
  const {screen,nodes}=fixture();
  await screen.run(async()=>({preview_only:true,metrics:{}}));
  assert.equal(nodes.analysisResults.hidden,true);
  assert.match(nodes.analysisMessage.textContent,/No results were saved/);
});

test('pending analysis stays visible and only response data becomes results',async()=>{
  const {screen,nodes}=fixture();
  let resolve, calls=0, completed=0;
  const work=()=>{calls++;return new Promise(r=>resolve=r)};
  const pending=screen.run(work,()=>completed++);
  assert.equal(nodes.assessmentCompletion.dataset.state,'analyzing');
  assert.equal(nodes.analysisResults.hidden,true);
  assert.equal(nodes.analysisFunctionSummary.hidden,true);
  await screen.run(work);
  assert.equal(calls,1);
  resolve(data); await pending;
  assert.equal(nodes.assessmentCompletion.dataset.state,'ready');
  assert.equal(completed,1);
  assert.equal(nodes.analysisPreviewNote,undefined);
  assert.equal(nodes.analysisFunctionSummary.hidden,true);
  const rows=nodes.analysisResults.children;
  assert.equal(rows[0].children[1].textContent,'85 / 100');
  assert.equal(rows[1].children[1].textContent,'—');
  assert.equal(rows[2].children[1].textContent,'Not assessed');
  await screen.run(work);
  assert.equal(calls,1);
});

test('failed request stops animation and retry reuses the existing movement data',async()=>{
  const {screen,nodes}=fixture();
  let attempts=0,completed=0;
  const work=async()=>{if(++attempts===1)throw Error('Offline');return data;};
  await screen.run(work,()=>completed++);
  assert.equal(nodes.assessmentCompletion.dataset.state,'error');
  assert.equal(nodes.analysisRetry.hidden,false);
  assert.equal(completed,0);
  await nodes.analysisRetry.onclick();
  assert.equal(attempts,2);
  assert.equal(completed,1);
  assert.equal(nodes.assessmentCompletion.dataset.state,'ready');
});

test('a hung request is aborted and cannot replace the error with a late response',async()=>{
  const {screen,nodes}=fixture({timeoutMs:10,slowMs:3});
  let signal,resolve,completed=false;
  await screen.run(s=>{signal=s;return new Promise(r=>resolve=r)},()=>completed=true);
  assert.equal(signal.aborted,true);
  assert.equal(nodes.assessmentCompletion.dataset.state,'error');
  resolve(data); await new Promise(r=>setTimeout(r,5));
  assert.equal(completed,false);
  assert.equal(nodes.assessmentCompletion.dataset.state,'error');
});

test('a disconnected host does not turn finished results into a second submission',async()=>{
  const {screen,nodes}=fixture();
  let calls=0;
  const work=async()=>{calls++;return data;};
  await screen.run(work,()=>{throw Error('Host closed');});
  assert.equal(nodes.assessmentCompletion.dataset.state,'ready');
  await screen.run(work);
  assert.equal(calls,1);
});

const source=fs.readFileSync(require.resolve('../server.py'),'utf8');
const finish=source.slice(source.indexOf('let completionScreen = null;'),source.indexOf('let lastTestingReachPoseVideoTime'));
for(const preview of [true,false])test(`runner finish uses ${preview?'stateless preview':'normal saved assessment'} and releases the camera`,async()=>{
  let stopped=false,cleared=false,posted,request;
  const video={videoWidth:640,videoHeight:480,srcObject:{getTracks:()=>[{stop:()=>{stopped=true;video.videoWidth=0;video.videoHeight=0;}}]}};
  const context={
    document:{body:{classList:{remove(){}}}},setInstructionsOpen(){},running:true,audioEl:{pause(){}},
    LOCAL_PREVIEW_MODE:preview,LIBRARY_TEST_MODE:false,video,canvas:{width:640,height:480},ctx:{clearRect(){cleared=true}},
    cameraFrame:{clientWidth:920,clientHeight:668},CAMERA_FIT_MODE:'contain',CAMERA_DEVICE_CLASS:'desktop',
    pendingTaskVideoSaves:new Set(),pendingTaskProgressSaves:new Set(),API_BASE:'http://127.0.0.1:8001/api',
    CURRENT_USER_ID:preview?'':'user',ACCOUNT_HEADERS:{'x-user-id':'user'},taskResults:data.task_results,
    tasks:[{id:'L6'}],AFFECTED_SIDE:'right',ASSESSMENT_PACKAGE:'initial',MOTION_SAMPLE_INTERVAL_MS:100,MAX_MOTION_FRAMES:500,motionFrames:[{}],
    window:{RehynAssessmentCompletion:{create:()=>({run:async(work,done)=>done(await work(new AbortController().signal))})}},
    fetch:async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({...data,id:preview?undefined:'saved'})}},
    postRN:m=>posted=m,
  };
  vm.runInNewContext(finish+';this.finishAssessment=finishAssessment;',context);
  await context.finishAssessment();
  assert.ok(stopped && cleared);
  const payload=JSON.parse(request.body);
  assert.equal(posted.type,preview?'assessment_preview_complete':'assessment_complete');
  assert.equal(posted.results_in_runner,true);
  if(preview){assert.match(request.url,/preview-results\?local_preview=1/);assert.equal(payload.motion_data,undefined);}
  else{assert.match(request.url,/assessment\/submit$/);assert.equal(payload.motion_data.camera_projection.source_width,640);}
});
