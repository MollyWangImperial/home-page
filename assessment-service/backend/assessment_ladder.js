/* Deterministic function assessment. Pure state; no camera, DOM or learning policy. */
(function(root){
  'use strict';
  // engineering default, needs clinician review — keep ladder thresholds here.
  const CONFIG=Object.freeze({attemptMs:8000,retryMs:6000,movementMs:5000,maxActiveMs:90000,
    maxAttempts:3,nearDistance:.18,movementDistance:.025,holdMs:1500,minMeasuredMs:500,
    maxFrameGapMs:250,poseConfidence:.65,partialGesture:.5,partialOpen:.25,fullPinch:.8,fullOpen:.65,fullClosed:.30,closedOpenMax:.62,
    otherHandNear:.07,otherHandMs:750,voiceSettleMs:350,returnMs:14000});
  const TASKS=Object.freeze({
    T1:{rungs:['r80','r120','r160'],full:'r160',heights:{r80:.8,r120:1.2,r160:1.6},checks:['trunk_lean','shoulder_hike']},
    T3:{rungs:['chest','mouth'],full:'mouth',checks:['trunk_lean','shoulder_hike','head_drop']},
    H4:{rungs:['partial','full'],full:'full',protocol:'hand_open_at_chest_v2',checks:['trunk_lean','shoulder_hike','wrist_bend']},
    H3:{rungs:['partial','full'],full:'full',checks:['trunk_lean','shoulder_hike','wrist_bend']}
  });
  const copy=value=>JSON.parse(JSON.stringify(value));
  class Ladder{
    constructor({taskId,rungs=TASKS[taskId]?.rungs,startRung,helper=false,fixedRung=null}={}){
      if(!TASKS[taskId] || !Array.isArray(rungs) || JSON.stringify(rungs)!==JSON.stringify(TASKS[taskId].rungs))throw new Error('Unsupported ladder');
      this.taskId=taskId;this.rungs=[...rungs];this.fullRung=this.rungs.at(-1);
      // Old links start at the lowest new target, rather than jumping to 160%.
      if(taskId==='T1' && ['r40','r55','r70','r85','r100'].includes(startRung))startRung='r80';
      this.fixedRung=taskId==='T3' && fixedRung===this.fullRung?fixedRung:null;
      this.startRung=this.fixedRung || (this.rungs.includes(startRung)?startRung:this.fullRung);
      this.index=this.rungs.indexOf(this.startRung);this.helper=helper===true;
      this.phase='cue';this.attempts=[];this.activeMs=0;this.measuredMs=0;this.movementSeen=false;
      this.last=null;this.direction=0;this.stoppedBy=null;this.stretchCompleted=false;this.prerequisiteNotMet=false;
      this.resetAttempt();
    }
    get rung(){return this.rungs[this.index];}
    get done(){return this.phase==='done';}
    resetAttempt(){this.elapsed=0;this.duration=0;this.bestDistance=Infinity;this.last=null;this.assist=null;this.checks={};}
    cueDone(){
      if(this.phase==='cue')this.phase='attempt';
      else if(this.phase==='encourage')this.phase='retry';
      else if(this.phase==='movement_cue')this.phase='movement';
      else return false;
      this.elapsed=0;this.last=null;return true;
    }
    tick({now,valid=false,paused=false,distance=Infinity,movement=false,compensations={}}={}){
      if(!Number.isFinite(now))return null;
      const dt=this.last===null?0:now-this.last;this.last=now;
      if(this.done || paused || !['attempt','retry','movement'].includes(this.phase) || dt<0 || dt>CONFIG.maxFrameGapMs)return null;
      this.activeMs+=dt;this.elapsed+=dt;this.duration+=dt;
      if(valid){
        this.measuredMs+=dt;this.movementSeen ||= movement===true;
        if(Number.isFinite(distance))this.bestDistance=Math.min(this.bestDistance,distance);
        for(const id of TASKS[this.taskId].checks){
          const status=compensations[id];
          if(status==='detected' || (status==='not_detected' && this.checks[id]!=='detected'))this.checks[id]=status;
        }
      }
      if(this.activeMs>=CONFIG.maxActiveMs){this.record(false);return this.finish('time_cap');}
      if(this.phase==='movement' && this.elapsed>=CONFIG.movementMs){this.phase='support_offer';this.last=null;return 'support_offer';}
      if(this.phase==='attempt' && this.elapsed>=CONFIG.attemptMs){this.phase='encourage';this.elapsed=0;return 'encourage';}
      if(this.phase==='retry' && this.elapsed>=CONFIG.retryMs)return this.complete(false);
      return null;
    }
    record(completed){
      if(!['attempt','retry','encourage'].includes(this.phase))return;
      this.attempts.push({rung:this.rung,completed:completed===true,assist:this.assist,
        near:this.bestDistance<CONFIG.nearDistance,duration_ms:Math.round(this.duration),
        compensations:Object.fromEntries(TASKS[this.taskId].checks.map(id=>[id,this.checks[id] || 'not_measured']))});
      if(completed)this.movementSeen=true;
    }
    complete(completed,{assist=this.assist}={}){
      if(!['attempt','retry','encourage'].includes(this.phase))return null;
      if(![null,'self','helper'].includes(assist))throw new Error('Assistance must be confirmed');
      this.assist=assist;this.record(completed);
      if(assist!==null)return this.finish(completed?'assisted_complete':'assisted_not_reached');
      if(completed && this.rung===this.fullRung)return this.finish('full_rung');
      if(!completed && (this.fixedRung || this.index===0)){this.phase='movement_cue';this.elapsed=0;this.last=null;return 'movement_cue';}
      const direction=completed?1:-1;
      if(this.direction && direction!==this.direction)return this.finish('reversal');
      if(this.attempts.length>=CONFIG.maxAttempts)return this.finish('attempt_cap');
      this.direction=direction;
      this.index=Math.min(this.rungs.length-1,Math.max(0,this.index+(completed?1:this.bestDistance<CONFIG.nearDistance?-1:-2)));
      this.resetAttempt();this.phase='cue';return 'cue';
    }
    tooHard(){return this.complete(false);}
    offerHelp(accepted){
      if(this.phase!=='support_offer')return null;
      if(!accepted)return this.finish('support_declined');
      this.index=this.fixedRung?this.rungs.indexOf(this.fixedRung):0;this.resetAttempt();this.assist=this.helper?'helper':'self';this.phase='cue';return 'cue';
    }
    finish(reason){this.stoppedBy=reason;this.phase='done';this.last=null;return 'done';}
    stop(reason='stopped'){if(!this.done)this.record(false);return this.finish(reason);}
    snapshot(){
      const best=assist=>this.attempts.filter(a=>a.completed && (assist?a.assist!==null:a.assist===null))
        .reduce((best,a)=>best===null || this.rungs.indexOf(a.rung)>this.rungs.indexOf(best)?a.rung:best,null);
      return copy({version:'rehyn-ladder-1',clinical_measure:false,rungs:this.rungs,full_rung:this.fullRung,start_rung:this.startRung,
        ...(TASKS[this.taskId].protocol?{protocol:TASKS[this.taskId].protocol}:{}),
        ...(this.fixedRung?{fixed_target:true}:{}),
        attempts:this.attempts,best_alone:best(false),best_assisted:best(true),movement_seen:this.movementSeen,
        stretch_completed:this.stretchCompleted,prerequisite_not_met:this.prerequisiteNotMet,
        measured:this.measuredMs>=CONFIG.minMeasuredMs || this.attempts.some(a=>a.completed),
        active_ms:Math.round(this.activeMs),stopped_by:this.stoppedBy});
    }
    static gatedPinch(){const ladder=new Ladder({taskId:'H3'});ladder.prerequisiteNotMet=true;ladder.finish('prerequisite_not_met');return ladder.snapshot();}
  }
  class HandCycle{
    constructor(){this.stage=0;}
    observe({open,closed,valid}){
      if(!valid)return false;
      if(this.stage===0 && open>=CONFIG.fullOpen)this.stage=1;
      else if(this.stage===1 && closed>=CONFIG.fullClosed && open<CONFIG.closedOpenMax)this.stage=2;
      return this.stage===2 && open>=CONFIG.fullOpen;
    }
  }
  const api={CONFIG,TASKS,Ladder,HandCycle};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.RehynAssessmentLadder=api;
})(typeof globalThis!=='undefined'?globalThis:this);
