# New User Welcome

- `/welcome` renders the first-assessment welcome design.
- `/` remains the existing returning-user dashboard. Its component is unchanged.
- `/alira?onboarding=1` retains the locked navigation and sends Home back to `/welcome`.
- The lock is a navigation cue, not access control or an authorization boundary.
- The welcome page now shows Alira's greeting and one invitation; the questions and
  the movement check follow on `/alira` and `/assessment`. See
  `docs/first-assessment-flow.md` for the flow and the `VITE_ASSESSMENT_BASE` setting
  (`VITE_ASSESSMENT_URL` is no longer read).

## Integration Still Needed

This repository has a hard-coded Zak demo profile and no patient authentication
or assessment-history API. The welcome route is deliberately separate so existing
users are not redirected based on missing data or a browser-visit counter.
The sign-in integration should send an authenticated user with confirmed empty
assessment history to `/welcome`, and users with existing assessment history to
`/`. Loading/error states must not be treated as an empty history.

Survey answers are saved on this device (browser storage) as the patient goes; the
movement check is the real Rehyn runner. Neither is tied to a patient record yet.

## Preview

Run `pnpm dev --host 127.0.0.1 --port 4203 --strictPort` and open `/welcome`.

The welcome emblem reuses `client/src/components/AliraAvatar.tsx`, with scoped
breathing and heartbeat-trace animations. Both stop for reduced-motion users.
The earlier seedling and phone illustrations are not used in this revised design.
The assessment panel shows three numbered step titles and one full-width start
button. Descriptions, time estimates, and its secondary chat button are omitted.
