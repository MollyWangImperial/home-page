# Function ladder: scoring and completion results

`backend/function_scoring.py` adds `rehyn-function-level-1` as a parallel,
nonclinical score. It does not replace `rehyn-task-quality-1`, Testing's angle
diagnostics, gait analysis, rewards, or exercise scoring. There are no database
calls in the module.

The backend returns it at `metrics.function_score` from preview results and
`build_functional_metrics`. Existing assessment read paths recompute it through
`_functional_metrics_with_survey_mobility`; historic task evidence and saved
metrics are not rewritten to backfill this score.

Phase 2 presents the daily function total, task-level labels, five-position level
indicators, and next-step guidance in the shared runner completion screen.
Unmeasured tasks stay unscored, skipped walking says "Not assessed", and measured
walking keeps its existing numeric score. Partial totals are explained. Older
responses without the supported `function_score` version retain the existing
task-quality rows. Phases 3–7 now connect the deterministic ladder, survey routing,
saved history, shared results, app rollout flag and exercise selection. See
`docs/function-ladder-implementation.md` for the completed phase report and verification limits.

## Levels

| Level | Label | Evidence | Points |
| --- | --- | --- | --- |
| — | Not measured | Target could not be judged | Excluded |
| 4 | Can do well | Full rung independently, all required posture checks observed and clear | 100 |
| 3 | Can do | Full rung independently, compensation detected or posture incompletely observed | 75 |
| 2 | Partly | Easier rung independently | 50 |
| 1 | Getting started | Completed a rung with confirmed help, or movement seen | 25 |
| 0 | Not yet | No movement, or pinch prerequisite not met | 0 |

Current ladder pinch is the exception: independently passing its full target earns
level 4 / 100 points regardless of posture observations, while those criteria are deferred.

The explicit pinch prerequisite is level 0 even though no pinch attempt was
made. Unknown or malformed evidence is unmeasured. An unassigned task does not
limit an activity; a missing assigned task makes it estimated.

## Ladder evidence contract

`metrics.ladder.version` must be `rehyn-ladder-1`. Canonical rung identifiers:

- T1: `r80`, `r120`, `r160`; full is `r160`. Heights are fractions of the
  calibrated lap-to-shoulder distance, not percentages of a patient's maximum range.
- T3: `chest`, `mouth`; full is `mouth`.
- H4 and H3: `partial`, `full`; full is `full`.

H4 now records `protocol: hand_open_at_chest_v2`: raise to a fixed chest circle,
turn the palm toward the camera at that same circle below the face, open the hand there,
then return to the original lap target. The chest circle is captured from fresh
shoulders, the lap reference and face position before initialization, leaving room
for both the full ring and upright fingers. It uses the large, body-scaled starting
radius throughout raising, palm orientation, opening and retries. Initialization
requires the affected wrist to rise from the calibrated lap, even if that lap falls
inside the enlarged circle. Palm-facing and opening activation use the tracked palm center, so a
wrist or fingertip inside the circle cannot substitute for a palm still over the
face. The lap return requires a fresh downward wrist movement, preventing the lower
opening position from completing the lap step immediately. T3 retains its anatomical
mouth target. Only the opening is scored. Partial/full opening use the existing
normalized opening metric with engineering thresholds 0.25/0.65, requiring a hold
and fresh affected-hand tracking. Both the orientation and opening stages require
the same palm projection check; an edge-on hand cannot close either circle.
These thresholds are not clinical cutoffs.
Earlier H4 open-close and mouth-position opening results retain their original labels
and scores. Progress comparisons exclude H4 across these different protocols and
suppress the total delta. The new placement has synthetic regression coverage;
live camera posture visibility still needs confirmation in the next recording.

Earlier T1 records declaring exactly `r40`, `r55`, `r70`, `r85`, `r100` or
`r40`, `r70`, `r100` retain their original full-height benchmark and scores.
New sessions use 80%, 120% and 160%; follow-ups start one available rung below
the previous best, with a minimum of 80%. Old start links and old reach history
start at 80%. Camera framing must accommodate the entire 160% circle; its height
is never clamped down to fit the screen. There is no extra optional stretch.
The large circles have fixed lateral offsets so their hit areas do not overlap;
each upward transition also requires a fresh lift of the affected wrist.
The ladder packs these fixed centers within the visible frame without shrinking
the circles. Stable lap detection is independent of whether reach framing is ready.
If the 160% circle cannot fit, the lap is retained and the calibration heading gives
the camera adjustment needed; assessment cannot start from an invalid reach layout.
The original Settings → Testing placement and exercise calibration are unchanged.
H3 starts with an unscored wrist hold in a starting circle before the fixed coin
appears and its pinch instruction plays. It then returns to the shared lap target.

For current ladder assessments, a completed full pinch on the patient's own earns
100 points (`full_pinch_alone`). Pinch posture and steadiness criteria are deferred:
detected or unmeasured posture does not cap a passed full pinch at 75. The function
result retains these readings in `posture_observations` with `posture_scored: false`;
they are not used as patient-facing compensation or deduction messages. The original
attempt evidence stays intact for debugging. Partial, assisted, failed and unmeasured
pinches keep their existing levels, as do original Testing and legacy task scores.
The five function score levels (0/25/50/75/100) remain; the full-rung condition now
means 160% for new T1 sessions. Changed T1 benchmarks are excluded from score
comparisons, and no overall change is reported across that benchmark change.

Every attempt supplies its rung, Boolean completion, and explicit assistance
(`null`, `helper`, or `self`). Only completed attempts count toward best rungs;
claimed `best_alone` or `best_assisted` summaries cannot award points. An easier
independent completion takes priority over a harder assisted completion.
Positioning support for a hand task is not movement assistance.

Full attempts supply the existing compensation statuses (`detected`,
`not_detected`, `not_measured`) for the task's checks. Missing statuses do not
mean clear posture. T3 includes head movement as well as trunk lean and shoulder
hiking; hand tasks retain the existing wrist check. A clean completed full
attempt establishes level 4. Stretch completion cannot increase the score.

Legacy derivation uses the named main target step, not completion counts or
angle attainment. It reuses `assessment_quality.compensation_checks`, including
the sustained-evidence rule. Full target completion without usable posture
evidence yields level 3. Counts with no identifiable step evidence remain
unmeasured.

## Aggregation and comparison

Area scores average measured tasks; partial areas are flagged. The total averages
scored areas equally. L6 retains its validated gait score without translating it
into a five-level camera-task result. No usable gait evidence means no leg score.

Scores store one decimal using half-up rounding. `display_total` and area
`display_score` round the original mean directly to avoid double rounding.
For example, 56.25 stores as 56.3 and displays as 56. Area averages are not rounded
before calculating the total.

`daily_activity_levels` implements the weakest-prerequisite rule in the plan.
The optional pure comparison helper uses shared T1/T3/H4/H3 tasks (and unchanged
L6 evidence), excluding retired T2/H1 from comparisons. It reports the compared
task IDs. Total changes are available only when the same areas have scores and
shared measurable evidence; otherwise it returns available area changes.

All score reports, task rows, area rows and activity rows declare
`clinical_measure: false`. Engineering defaults are named in the scoring module
and require clinician review.
