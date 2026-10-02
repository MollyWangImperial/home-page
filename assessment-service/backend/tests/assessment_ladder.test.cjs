const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Ladder,CONFIG,TASKS}=require('../assessment_ladder.js');
function tick(ladder,ms,observation={}){let now=ladder.last??0;ladder.tick({now,valid:true,...observation});let event;
  for(let elapsed=0;elapsed<ms;elapsed+=100){now+=100;event=ladder.tick({now,valid:true,...observation})||event;}return event;}
function start(opts={}){const ladder=new Ladder({taskId:'T1',...opts});ladder.cueDone();return ladder;}
test('starts at requested rung, defaults full, and rejects unknown task',()=>{
  assert.equal(start({startRung:'r120'}).rung,'r120');assert.equal(start().rung,'r160');assert.equal(start({startRung:'bad'}).rung,'r160');
  assert.throws(()=>start({taskId:'L6'}));
});
test('success climbs one rung; full success stops with measured evidence',()=>{
  const l=start({startRung:'r120'});assert.equal(l.complete(true),'cue');assert.equal(l.rung,'r160');l.cueDone();l.complete(true);
  assert.equal(l.stoppedBy,'full_rung');assert.equal(l.snapshot().best_alone,'r160');assert.equal(l.snapshot().measured,true);
});
test('not reached lowers one if near, two if far',()=>{
  for(const [distance,expected] of [[.17,'r120'],[.18,'r80'],[Infinity,'r80']]){
    const l=start();tick(l,100,{distance});l.complete(false);assert.equal(l.rung,expected);
  }
});
test('first reversal stops in both directions, retaining best successful rung',()=>{
  const up=start({startRung:'r120'});up.complete(true);up.cueDone();up.complete(false);assert.equal(up.stoppedBy,'reversal');assert.equal(up.snapshot().best_alone,'r120');
  const down=start();down.complete(false);down.cueDone();down.complete(true);assert.equal(down.stoppedBy,'reversal');assert.equal(down.snapshot().best_alone,'r80');
});
test('reach uses only 80%, 120% and 160%, completing ascent in three attempts',()=>{
  assert.deepEqual(TASKS.T1.heights,{r80:.8,r120:1.2,r160:1.6});
  const l=start({startRung:'r80'});for(let i=0;i<3;i++){l.complete(true);l.cueDone();}
  assert.deepEqual(l.attempts.map(a=>a.rung),['r80','r120','r160']);
  assert.equal(l.stoppedBy,'full_rung');assert.equal(l.snapshot().best_alone,'r160');
});
test('retired bookmarked starts map to an easier available height',()=>{
  for(const startRung of ['r40','r55','r70','r85','r100'])assert.equal(start({startRung}).rung,'r80');
});
test('eight seconds then encouragement, then six more active seconds',()=>{
  const l=start();assert.equal(tick(l,CONFIG.attemptMs),'encourage');tick(l,5000);assert.equal(l.phase,'encourage');
  l.cueDone();assert.equal(tick(l,CONFIG.retryMs),'cue');assert.equal(l.attempts[0].duration_ms,14000);
});
test('bottom includes five-second movement observation and one explicitly accepted helper attempt',()=>{
  const l=start({startRung:'r80',helper:true});l.tooHard();assert.equal(l.phase,'movement_cue');l.cueDone();
  assert.equal(tick(l,CONFIG.movementMs,{movement:true}),'support_offer');l.offerHelp(true);l.cueDone();l.complete(true);
  assert.equal(l.stoppedBy,'assisted_complete');assert.equal(l.snapshot().best_assisted,'r80');assert.equal(l.snapshot().best_alone,null);
  assert.equal(l.attempts[1].assist,'helper');assert.equal(l.snapshot().movement_seen,true);
});
test('self-assist and declining help never loop',()=>{
  const l=start({taskId:'T3',startRung:'chest'});l.tooHard();l.cueDone();tick(l,5000);l.offerHelp(true);l.cueDone();l.tooHard();
  assert.equal(l.attempts.at(-1).assist,'self');assert.equal(l.stoppedBy,'assisted_not_reached');assert.equal(l.tooHard(),null);
  const decline=start({startRung:'r80'});decline.tooHard();decline.cueDone();tick(decline,5000);decline.offerHelp(false);assert.equal(decline.stoppedBy,'support_declined');
});
test('invalid tracking cannot invent no-movement evidence, while valid stillness is measured',()=>{
  const invalid=start();tick(invalid,8000,{valid:false});invalid.stop();assert.equal(invalid.snapshot().measured,false);
  const still=start();tick(still,500);still.stop();assert.equal(still.snapshot().measured,true);assert.equal(still.snapshot().movement_seen,false);
});
test('pause and frame gaps do not consume trying time, active time cap terminates',()=>{
  const l=start();tick(l,2000,{paused:true});assert.equal(l.activeMs,0);l.tick({now:100000,valid:true});assert.equal(l.activeMs,0);
  l.activeMs=CONFIG.maxActiveMs-100;assert.equal(tick(l,100),'done');assert.equal(l.stoppedBy,'time_cap');
});
test('confirmed posture evidence persists per attempt and resets for the next',()=>{
  const l=start({startRung:'r120'});tick(l,500,{compensations:{trunk_lean:'detected',shoulder_hike:'not_detected'}});
  tick(l,100,{compensations:{trunk_lean:'not_detected'}});l.complete(true);l.cueDone();l.complete(true);
  assert.equal(l.attempts[0].compensations.trunk_lean,'detected');assert.equal(l.attempts[1].compensations.trunk_lean,'not_measured');
  const snap=l.snapshot();snap.attempts[0].compensations.trunk_lean='x';assert.equal(l.attempts[0].compensations.trunk_lean,'detected');
});
test('confirmed other-hand help is assistance; gated pinch sends a complete evidence object',()=>{
  const l=start();l.complete(true,{assist:'self'});assert.equal(l.snapshot().best_alone,null);assert.equal(l.snapshot().best_assisted,'r160');
  const gate=Ladder.gatedPinch();assert.equal(gate.prerequisite_not_met,true);assert.equal(gate.stopped_by,'prerequisite_not_met');assert.equal(gate.clinical_measure,false);
});
