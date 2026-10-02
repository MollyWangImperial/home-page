# Function ladder implementation — 30 September 2026

The implementation covers phases 0–7 of the supplied plan. Changes remain local;
nothing was pushed or deployed. The current twelve companion questions are retained,
as requested. No new pre-camera pain or sitting questions were added.

## Follow-up UI change — 30 September 2026

The patient should not need to move toward the screen to answer questions between
movements. The after-task effort/pain dialogs and the two bottom controls (Too hard
right now and Pain) have therefore been removed at the user's request. After the
unscored lap return, the runner records the task and advances automatically. The
existing attempt timers still lower the target when it is not reached. Effort/pain
remain unanswered (`null`); the application does not infer "easy" or "no pain".
Other explicit helper/assistance choices remain as implemented.
The phase table below describes the initial implementation before this follow-up.

The ladder now uses the shared between-task celebration after each task's lap
return (including a timed-out return or declined support). It shows the existing
animated green check, encouragement and the next task. After the announcement
finishes, a ring fills continuously over three seconds before the screen fades
and advances automatically, with no touch confirmation. The final check uses the
same ring before analysis. Completion speech is prefetched when the
task starts. Recording, local review and progress are saved once through the shared
transition. Gated pinch is described as left for another day; an early finish does
not introduce tasks that will not run. The final transition continues to analysis.

The transition regression tests execute the shared runner function, including
voice/timer blocking, a full countdown after long speech, reset between tasks,
the final countdown before analysis, duplicate completion callbacks, declined help, early finish,
pinch gating and the complete four-task sequence.

## Phase report

Follow-up reach adjustment: new T1 sessions use only 80%, 120% and 160% of the
calibrated lap-to-shoulder height, with at most three independent target attempts.
Follow-up starts use the next lower available height; old start links and history
start at 80%. Camera framing checks the full 160% circle before calibration finishes.
Historic three/five-height records retain their scores and displayed reach; score
changes are not compared across different full-height benchmarks. Results charts
include heights above 100%. The optional assisted attempt remains, but no additional
stretch follows the 160% target. The five function score levels remain unchanged.

| Phase | Implemented behavior | Verification |
| --- | --- | --- |
| 0 — Local sandbox | The companion requests T1, T3, H4, H3, then L6. Loopback preview needs both the URL switch and server opt-in; it does not access patient records. | Live JSON task selection and a stateless four-task scoring replay; local-only authorization tests. |
| 1 — Scoring | Parallel `rehyn-function-level-1`: 0/25/50/75/100, unmeasured excluded, equal-weight area averages, weakest-link daily activities, read-time legacy derivation. The quality scorer remains. | Worked examples A–E, every score branch, posture unknown, assistance, rounding, legacy results and comparisons. |
| 2 — Initial results | Shared completion page shows total, task levels, five dots and next steps. Older responses retain the quality-score fallback. | Completion presentation tests and browser examples. |
| 3 — Engine | A deterministic staircase replaces learning only in ladder mode: likely start, up one/down one or two, first reversal, up to three independent attempts, bottom movement check, one confirmed assisted attempt and active time cap. | Pure engine tests including timing, missing tracking, pauses, assistance and evidence isolation. |
| 4 — Runner | T1 reach heights, T3 chest/mouth, H4 open-close-open and H3 pinch use the shared camera runner. Visible Too hard and Pain controls, pre-camera helper confirmation, explicit self-assist, pinch prerequisite, one unscored return and post-task effort/pain. | Four-task adapter replay, gesture and tracking tests, helper-proximity regression, real local preview scoring endpoint. |
| 5 — Companion + richer results | Survey answers select tasks, rungs, helper and walking instruction. Results add area cards, previous reach, own-baseline comparison, daily life, confirmed coaching and collapsed diagnostics. | 19 survey/URL tests; desktop and 375px phone browser checks, including opening Details. |
| 6 — Original app | Core initial/follow-up lists updated; combined follow-up covers every affected area. Next start is one rung below the previous best. App opt-in is controlled by `FUNCTION_LADDER_ENABLED`. Saved results and Testing use the new presentation; T2/H1 remain in Testing. | Orchestrator/config/API tests, isolated submit/read round trip, both TypeScript checks. |
| 7 — Exercise plan | Selects two lowest measured tasks, a goal slot and a success slot, combining duplicate exercises. Levels 0–1 use the existing supported programme; level 2 uses easy and the best target; level 3 addresses confirmed compensation; level 4 uses functional grasp/pinch. Existing eligibility and pain gates apply. | Selection and safety tests; saved plan round trip; later model-result callback preserves the ladder plan; original exercise scoring is unchanged. |

## Local preview and rollout

- Companion: http://127.0.0.1:3000/assessment?onboarding=1
- Backend runner: http://127.0.0.1:8001/api/pose/runner
- The companion sends `ladder=1`, `task_ids`, JSON `start_rung`, `helper` and `main_goal`.
- The app reads authenticated `/api/assessment/function-config`. The server flag defaults
  **off**, and is explicitly **on in the current local backend process**.
- Settings → Testing has an optional function-ladder switch for T1/T3/H4/H3. It is off by default.
- Without `ladder=1`, the runner retains its existing path. Testing retains the existing angle diagnostics.
- Local anonymous preview requires `REHYN_LOCAL_ASSESSMENT_PREVIEW=1` plus `local_preview=1`
  on a loopback request. Ordinary anonymous task requests still receive 401.
- The hosted companion has no patient sign-in integration. It cannot currently use the
  authenticated hosted task endpoint; anonymous production saving was not added.
- The local preview has no saved history. Own-baseline changes and previous reach marks
  are for authenticated saved assessments.

## Final verification

- **144/144 backend JavaScript tests passed.** Includes engine, runner adapter,
  completion screen and legacy Testing behavior.
- Hand-only task selections load the hand model before calibration. H4 now runs
  starting circle → calibrated mouth → hand opening at that same circle → original
  lap. Its starting point and radii stay fixed; its mouth anchor is captured after
  positioning and retained across gesture retries. Preparation does not score
  finger function, and incomplete positioning remains unmeasured. H3 retains its
  supported-palm target. These paths have dedicated regression tests.
- **19/19 companion assessment tests passed.**
- **Both frontend TypeScript checks passed** (`tsc --noEmit`).
- **273 backend Python tests passed; two existing survey-report tests still fail.**
  This selection includes function scoring, integration, functional progress,
  preview, orchestrator, care API, multidomain, Testing library and survey exercise policy.
- The two failures are
  `test_survey_report_is_built_from_the_survey_alone_when_no_tasks_exist` and
  `test_viewing_the_survey_report_moves_the_next_step_on_to_the_rehab_plan` in
  `D:/rh-release/backend/tests/test_alira_care_api.py`. Their fixture lacks the current
  readiness version; both the original HEAD orchestrator and current orchestrator
  classify it as needing answers. That unrelated survey behavior was not changed.
- The full repository suite was not established as passing: earlier collection
  was blocked by unavailable optional model/runtime dependencies. The scoped result above
  is the verified result, not a claim about all repository tests.
- A **synthetic four-task runner replay** was POSTed through the restarted live local
  preview endpoint. It returned T1/T3/H4/H3 levels **2/3/3/3**, total **69**,
  `preview_only: true`, and `saved_to_assessment: false`.
- The preview validator now accepts the bounded versioned rung IDs, including gated
  pinch, while rejecting mismatched, duplicate and unsupported rung evidence.
- **15 scripts extracted from the served runner HTML passed Node syntax checks.**
- The actual V2 assessment URL was reopened and visibly reached **Ready to begin?**
  with the survey-selected ladder URL in its iframe.

Evidence files are in `D:/rh-tmp/`:

- `function-ladder-final-node.log`
- `function-ladder-final-python.log`
- `function-ladder-final-v2-tests.log`
- `function-ladder-final-app-tsc.log`, `function-ladder-final-v2-tsc.log`
- `function-ladder-live-replay-response.json`
- `function-ladder-results.png` (explicitly labelled synthetic results)

## Practical limits

No live patient camera session or recording review was performed for this implementation.
Gesture thresholds and target fractions are engineering defaults, not clinically
validated limits. Existing camera/calibration/compensation detectors were reused.
The task metadata's old side-view labels were not used to redesign those detectors;
the existing frontal camera setup still needs real recording review before deployment.

Saving was verified through the real submit/read handlers with an isolated in-memory
store. Local MongoDB is unavailable, so this was not a live database persistence test.
Voice timing and pause behavior have automated coverage; live audio playback was not
verified. The local voice service may fall back to the device voice as before.

## Main files changed for this plan

Both repositories already contained unrelated work. This list identifies this plan's
files; it does not claim every dirty file in either repository was changed here.

Backend and runner:

- `D:/rh-release/backend/function_scoring.py`
- `D:/rh-release/backend/assessment_ladder.js`
- `D:/rh-release/backend/assessment_ladder_flow.js`
- `D:/rh-release/backend/assessment_ladder_ui.html`
- `D:/rh-release/backend/assessment_completion.js`
- `D:/rh-release/backend/assessment_completion_ui.html`
- `D:/rh-release/backend/function_assessment_config.py`
- `D:/rh-release/backend/function_rehab_plan.py`
- `D:/rh-release/backend/server.py`
- `D:/rh-release/backend/alira_care_orchestrator.py`
- `D:/rh-release/backend/daily_activity_metrics.py`
- `D:/rh-release/backend/testing_reach_flow.js`
- `D:/rh-release/backend/testing_mouth_flow.js`

Companion:

- `D:/repos/rehyn-recovery-companion-v2/client/src/lib/assessment.ts`
- `D:/repos/rehyn-recovery-companion-v2/client/src/lib/assessment.test.ts`
- `D:/repos/rehyn-recovery-companion-v2/client/src/pages/Assessment.tsx`
- `D:/repos/rehyn-recovery-companion-v2/docs/first-assessment-flow.md`

Original app:

- `D:/rh-release/frontend/src/api.ts`
- `D:/rh-release/frontend/src/aliraNavigation.ts`
- `D:/rh-release/frontend/src/auth.ts`
- `D:/rh-release/frontend/src/components/FunctionResultsPanel.tsx`
- `D:/rh-release/frontend/src/components/MovementScoresPanel.tsx`
- `D:/rh-release/frontend/src/components/AssessmentTestResults.tsx`
- `D:/rh-release/frontend/app/assessment.tsx`
- `D:/rh-release/frontend/app/task-intro.tsx`
- `D:/rh-release/frontend/app/results.tsx`
- `D:/rh-release/frontend/app/testing-library.tsx`
- `D:/rh-release/frontend/app/rehab-plan.tsx`
- `D:/rh-release/frontend/app/exercise.tsx`

New or extended regression coverage is under `D:/rh-release/backend/tests/`, especially
`test_function_scoring.py`, `test_function_integration.py`, `test_local_assessment_preview.py`,
`assessment_ladder.test.cjs`, `assessment_ladder_flow.test.cjs` and
`assessment_completion.test.cjs`. Existing task-list and Testing harness expectations
were updated where this plan deliberately changes the behavior.

## October 1 patient feedback

H4 starting-circle radius uses the same body-scaled chest-circle sizing as T3 and locks it for the positioning stage. The mouth and lap anchors keep their existing fixed geometry.

Ladder trunk-lean evidence (`image_face_shoulder_growth_v1`) requires simultaneous shoulder-span growth above 12% and face-span growth above 7%, sustained for at least 500 ms against the seated reference. Both image spans are corrected for aspect ratio and divided by pelvis-span growth; shoulders are projected onto the upright reference axis to separate shoulder lifting. Missing face/hip landmarks or marked head turning abstain. These are engineering screening defaults and camera-scale proxies, not a validated clinical trunk angle. Completion stays independent of compensation findings.

Partial-result coaching starts with encouragement and explains the recorded reason: an easier target, assistance, a detected compensation, or posture/tracking that could not be measured. The patient-facing reach-height percentage caption is removed; Today/Previous chart markers remain.

### Fixed mouth target for local testing

Local ladder previews lock T3 to the first stable mouth-corner midpoint for the full task. T3 starts at the mouth even when the survey supplied a chest starting rung, and failed independent or assisted attempts do not lower it to the chest. Retry/help time limits and scoring still apply; the snapshot records `fixed_target: true`. Production assessment selection keeps its existing adaptive ladder.
