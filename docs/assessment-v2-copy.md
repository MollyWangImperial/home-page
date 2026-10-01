# Current v2 assessment copied into the Claude companion

The assessment behind v2 Alira’s **Start now** is now included in this repository.
The other Alira, Journal, Medals and Exercise engine screens are retained.

## Source map

- Host page: `client/src/pages/Assessment.tsx` and `assessment.css`, copied from
  `D:/repos/rehyn-recovery-companion-v2`.
- Runner URL and scored-report storage: `client/src/lib/assessment.ts`. Its existing
  `companionTaskPlan` export remains compatible with this site’s onboarding callers.
- Actual camera UI, targets, calibration, gestures, score calculation and transitions:
  `assessment-service/backend`, copied from `D:/rh-release/backend`.
- Browser pose/hand models and WASM: `assessment-service/frontend/public/vendor/mediapipe`.
- Prepared instruction audio: `assessment-service/frontend/public/audio/prepared`.
- Trunk-lean helpers: `assessment-service/testing/trunk-lean-comparison`.
- Copied backend regression tests: `assessment-service/backend/tests`.
- `assessment-service/source-manifest.json` records source paths and SHA-256 hashes.

The service keeps the full shared source modules because the runner is embedded in
the original monolithic `server.py`. Its scoring and camera code are copied unchanged.
Account data, credentials, old recordings, private voice samples and caches are not copied.

## Run the copied assessment locally

Use Python with the dependencies in `assessment-service/backend/requirements-deploy.txt`
and the Node runtime used by this site. A project `.venv` is detected automatically;
otherwise the launcher uses `python` or `REHYN_ASSESSMENT_PYTHON`.

```powershell
# If needed, select an already configured Python interpreter:
$env:REHYN_ASSESSMENT_PYTHON = 'D:/repos/axonai_app_conflict_290826_1558/.venv/Scripts/python.exe'
npm run dev:assessment
```

This starts the companion at http://127.0.0.1:3003 and its copied backend at
http://127.0.0.1:8002, both bound to this computer. Open
http://127.0.0.1:3003/assessment?onboarding=1 or use this site’s existing Start now button.
The launcher explicitly enables local preview and the function ladder.
`npm run assessment:dev` runs only the copied backend. Existing `npm run dev` is unchanged;
`.env.local` points its assessment frame at port 8002.

Task order is T1 → T3 → H4 → H3 → L6, subject to the existing survey task exclusions.
Reach levels are 80%, 120% and 160%. Mouth preparation, palm orientation, sufficient
hand opening, pinch preparation, lap return and the three-second completion countdown
use the same code as the v2 assessment. Local reports keep their scores and task summaries
so callers can use them after returning to Alira.

Debug recordings from new assessments belong only to
`assessment-service/backend/.local_state/assessment-debug/latest/`. The copied recorder
overwrites that copy’s latest session when a new assessment starts. The source website’s
recordings remain in its original folder.

Hosted deployment still requires the original account/sign-in integration. This local
preview does not add anonymous production saving. Credentials for live cloud TTS are
not bundled; existing prepared cues/device speech fallbacks retain their original behavior.
