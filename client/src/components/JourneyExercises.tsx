import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Dumbbell } from "lucide-react";
import { loadRememberedAssessment, type PlanExercise } from "@/lib/assessment";
import { planExerciseUrl, scoreSummary } from "@/lib/assessment-plan";
import { loadOnboardingAnswers } from "@/lib/alira-onboarding";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import "./journey-exercises.css";

export default function JourneyExercises({ reveal = false }: { reveal?: boolean }) {
  const [assessment] = useState(loadRememberedAssessment);
  const [selected, setSelected] = useState<PlanExercise | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const report = assessment?.report;
  const exercises = report?.rehab_plan;
  const domains = report?.function_rehab_plan?.caregiver_domains ?? [];
  const blocked = report?.clinical_review_gate?.rehab_access === "blocked";
  const goalLabels: Record<string, string> = { eating: "Eating and drinking without help", dressing: "Dressing myself", walking_house: "Walking around the house", going_out: "Going out and about", other: "My everyday goal" };
  useEffect(() => {
    if (!reveal) return;
    const timer = window.setTimeout(() => {
      heading.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      heading.current?.focus({ preventScroll: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [reveal]);

  return <section className="journey-exercises" id="exercises" aria-labelledby="exercises-heading">
    <div className="journey-exercises-heading"><span aria-hidden="true"><Dumbbell size={25} /></span><div>
      <h2 id="exercises-heading" ref={heading} tabIndex={-1}>Your exercise plan</h2>
      <p>{report ? `Based on your movement check: ${scoreSummary(report)}.` : "Your movement check will help Alira choose your next exercises."}</p>
    </div></div>
    {blocked && <p className="journey-exercise-note">{report?.clinical_review_gate?.patient_message}</p>}
    {exercises?.length ? <div className="journey-exercise-grid">{exercises.map(exercise => <article className="journey-exercise" key={exercise.id}>
      <span className="recovery-overline">{exercise.difficulty === "easy" ? "A gentle starting point" : "Build on your movement"}</span>
      <h3>{exercise.name}</h3><p>{exercise.description}</p>
      <div className="journey-exercise-dose"><span>{exercise.sets} {exercise.sets === 1 ? "set" : "sets"} · {exercise.reps} repetitions</span><span>{exercise.frequency}</span></div>
      {exercise.linked_goal && <p className="journey-exercise-goal"><Check size={15} aria-hidden="true" /> Your goal: {goalLabels[exercise.linked_goal] ?? exercise.linked_goal}</p>}
      <button type="button" onClick={() => setSelected(exercise)}>View exercise <ArrowRight size={16} aria-hidden="true" /></button>
    </article>)}</div> : <p>{Array.isArray(exercises) ? domains.length ? "We’ll start with supported movement. The next step is to review suitable movements with your carer or rehabilitation clinician." : "No camera exercises were selected from these results. Alira can help you review the next step." : "Your exercise plan has not been prepared yet."} <a href="/alira">Talk to Alira</a></p>}
    <Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent>{selected && <>
        <DialogTitle>{selected.name}</DialogTitle><DialogDescription>{selected.description}</DialogDescription>
        <p>{selected.sets} sets · {selected.reps} repetitions · {selected.frequency}</p>
        {selected.selection_reason && <p>{selected.selection_reason}</p>}
        {selected.safety_note && <p>{selected.safety_note}</p>}
        {blocked ? <p>{report?.clinical_review_gate?.patient_message}</p> : <a className="journey-exercise-start" href={planExerciseUrl(selected, loadOnboardingAnswers().side_affected === "left" ? "left" : "right")} target="_blank" rel="noopener noreferrer">Open exercise <ArrowRight size={16} /></a>}
      </>}</DialogContent>
    </Dialog>
  </section>;
}
