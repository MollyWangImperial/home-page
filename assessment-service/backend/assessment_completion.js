/* Completion presentation shared by the standalone and embedded assessment runner. */
(function(root){
  "use strict";
  function create({document:doc=root.document, onExit, minimumMs=1800, timeoutMs=90000, slowMs=15000}={}){
    const byId=id=>doc.getElementById(id);
    const panel=byId("assessmentCompletion"), title=byId("analysisTitle"), message=byId("analysisMessage");
    const results=byId("analysisResults"), actions=byId("analysisActions"), retry=byId("analysisRetry"), exit=byId("analysisExit");
    const summary=byId("analysisFunctionSummary"), scoreNumber=byId("analysisScoreNumber"), scoreUnit=byId("analysisScoreUnit");
    const validScore=value=>typeof value==="number" && Number.isFinite(value) && value>=0 && value<=100;
    const validLevel=value=>Number.isInteger(value) && value>=0 && value<=4;
    const sectionIds=['analysisAreas','analysisCoaching','analysisChange'];
    const areaLabels={upper_limb:'Arm',hand:'Hand',lower_limb:'Walking'};
    const add=(parent,tag,text,className)=>{const node=doc.createElement(tag);node.textContent=text;if(className)node.className=className;parent.append(node);return node;};
    function showFunctionDetails(data,score){
      const areas=byId('analysisAreas');areas.replaceChildren();
      for(const [id,area] of Object.entries(score.areas || {})){
        const card=doc.createElement('div');card.className='analysisArea';
        add(card,'h2',areaLabels[id] || id);add(card,'strong',validScore(area.score)?`${area.display_score ?? Math.round(area.score)} / 100`:'Not measured');
        if(area.partial)add(card,'small','Some movements could not be measured.');
        const change=score.comparison?.areas?.[id]?.change;
        if(typeof change==='number' && Number.isFinite(change))add(card,'small',`${change>0?'+':''}${change} from your first assessment`);
        areas.append(card);
      }
      areas.hidden=!areas.children.length;
      const comparison=score.comparison,change=byId('analysisChange');
      if(comparison?.total_comparable && typeof comparison.total_change==='number'){
        change.textContent=`${comparison.total_change>0?'+':''}${comparison.total_change} from your first assessment`;change.hidden=false;
      }
      const coaching=byId('analysisCoachingRows');coaching.replaceChildren();
      const confirmed=new Set(score.tasks.flatMap(task=>Object.entries(task.compensations || {}).filter(([,status])=>status==='detected').map(([id])=>id)));
      const copy={trunk_lean:'You leaned forward to help your arm.',shoulder_hike:'You lifted your shoulder to help the movement.',head_drop:'You brought your head toward your hand.',wrist_bend:'You bent your wrist to help the movement.'};
      for(const id of confirmed)if(copy[id])add(coaching,'p',`${copy[id]} That is a normal way to get there. Your exercises will help you practise the movement with less compensation.`);
      byId('analysisCoaching').hidden=!coaching.children.length;
    }
    let busy=false, finished=false;
    exit.onclick=()=>onExit?.();
    function appendFunctionTask(task,skipped,quality){
      const row=doc.createElement("li"), heading=doc.createElement("div"), name=doc.createElement("h2"), level=doc.createElement("strong");
      row.className="analysisResult analysisFunctionResult";
      row.dataset.taskId=task.task_id;
      heading.className="analysisTaskHeading";
      name.className="analysisTaskName";
      name.textContent=task.task_label || quality?.tasks?.find(item=>item.task_id===task.task_id)?.label || task.task_id;
      level.className="analysisTaskLevel";
      const measured=validScore(task.points), hasLevel=measured && validLevel(task.level) && task.task_id!=="L6";
      if(skipped) level.textContent="Not assessed";
      else if(hasLevel) level.textContent=task.label;
      else if(measured && task.task_id==="L6") level.textContent=`${Math.round(task.points)} / 100`;
      else level.textContent="Not measured";
      heading.append(name,level); row.append(heading);
      if(hasLevel && !skipped){
        // Five positions represent levels 0–4; the words carry the meaning.
        const track=doc.createElement("span");
        track.className="analysisLevelTrack"; track.setAttribute("aria-hidden","true");
        for(let index=0;index<5;index++){
          const dot=doc.createElement("i");
          dot.className="analysisLevelDot"+(index<=task.level ? " is-reached" : "")+(index===task.level ? " is-current" : "");
          track.append(dot);
        }
        row.append(track);
      }
      if(typeof task.next_step==="string" && task.next_step && !skipped){
        const next=doc.createElement("p");
        next.className="analysisNextStep"; next.textContent=task.next_step;
        row.append(next);
      }
      results.append(row);
    }
    function showResults(data){
      const quality=data.metrics?.task_quality;
      const functionScore=data.metrics?.function_score;
      const useFunctionScore=functionScore?.version==="rehyn-function-level-1" && Array.isArray(functionScore.tasks);
      const skipped=new Set((data.task_results || []).filter(t=>t.metrics?.walking_skipped).map(t=>t.task_id));
      results.replaceChildren();
      summary.hidden=!useFunctionScore;
      for(const id of sectionIds)byId(id).hidden=true;
      panel.dataset.resultFormat=useFunctionScore ? "function" : "quality";
      if(useFunctionScore){
        const measured=validScore(functionScore.total);
        scoreNumber.textContent=measured ? String(Number.isInteger(functionScore.display_total) && validScore(functionScore.display_total)
          ? functionScore.display_total : Math.round(functionScore.total)) : "—";
        scoreUnit.hidden=!measured;
        const partial=Object.values(functionScore.areas || {}).some(area=>area?.partial===true);
        byId("analysisScoreNote").textContent=!measured ? "There wasn’t enough measured movement to give a daily function score."
          : partial ? "Based on the movements we could measure today. Some movements could not be measured."
          : "Your score reflects the movements you completed and the help you needed.";
        for(const task of functionScore.tasks) appendFunctionTask(task,skipped.has(task.task_id),quality);
        showFunctionDetails(data,functionScore);
      }else for(const task of quality?.tasks || []){
        const row=doc.createElement("li"), label=doc.createElement("span"), value=doc.createElement("strong");
        row.className="analysisResult";
        label.textContent=task.label;
        if(skipped.has(task.task_id)) value.textContent="Not assessed";
        else if(typeof task.score==="number" && Number.isFinite(task.score)) value.textContent=`${Math.round(task.score)} / 100`;
        else{
          value.textContent="—";
          const note=doc.createElement("small");
          note.textContent="Not enough measured movement to give a score.";
          label.append(note);
        }
        row.append(label,value); results.append(row);
      }
      results.hidden=!results.children.length;
      title.textContent="Your movement results";
      message.textContent=useFunctionScore ? "What you could do today, and one next step."
        : results.children.length ? "Here’s what we measured in this movement check."
        : data.preview_only ? "Your preview is complete. No results were saved."
        : "Your movement check is saved. You can return to your assessment results.";
      panel.dataset.state="ready"; panel.setAttribute("aria-busy","false");
      actions.hidden=false; retry.hidden=true; exit.textContent="Done";
      title.focus({preventScroll:true});
    }
    async function run(work,onComplete){
      if(busy || finished) return;
      busy=true;
      doc.body.classList.add("assessment-finishing");
      panel.hidden=false; panel.dataset.state="analyzing"; panel.setAttribute("aria-busy","true");
      title.textContent="Analyzing your movement";
      message.textContent="Your movement check is complete. We’re bringing your results together.";
      actions.hidden=true; results.hidden=true; summary.hidden=true; retry.hidden=true;
      for(const id of sectionIds)byId(id).hidden=true;
      title.focus({preventScroll:true});
      const controller=new AbortController();
      let timeout;
      const slow=setTimeout(()=>{message.textContent="This is taking a little longer. Please keep this page open.";},slowMs);
      try{
        // The motion conveys activity, never an invented analysis percentage.
        const result=await Promise.race([
          Promise.all([work(controller.signal),new Promise(resolve=>setTimeout(resolve,minimumMs))]).then(([data])=>data),
          new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error("Analysis timed out"));},timeoutMs);})
        ]);
        clearTimeout(slow); clearTimeout(timeout);
        showResults(result);
        finished=true;
        // A closed host must not turn successful analysis into a retryable save.
        try{onComplete?.(result);}catch{}
      }catch(error){
        clearTimeout(slow); clearTimeout(timeout);
        panel.dataset.state="error"; panel.setAttribute("aria-busy","false");
        title.textContent="We couldn’t finish the analysis";
        message.textContent="Your movement data is still here. Try again to get your results.";
        summary.hidden=true; results.hidden=true;
        actions.hidden=false; retry.hidden=false; exit.textContent="Back";
        retry.onclick=()=>run(work,onComplete);
        title.focus({preventScroll:true});
      }finally{busy=false;}
    }
    return {run};
  }
  const api={create};
  if(typeof module!=="undefined" && module.exports)module.exports=api;
  else root.RehynAssessmentCompletion=api;
})(typeof window!=="undefined" ? window : globalThis);
