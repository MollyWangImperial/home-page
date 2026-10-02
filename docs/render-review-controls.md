# Administrative controls on the review site

The local development preview and https://rehyn-recovery-companion.onrender.com retain the same administrative controls. Other production origins do not enable the development controls. Production still uses the hosted assessment service.

- Home: Reset account, with the existing recoverable account snapshot.
- Alira: Administrative control for the remaining survey questions; Finish assessment with random scores; Finish exercises with random scores.
- Warm-up: Pretend warm-up (testing), on the same camera-error screen as locally.
- Journey: load a sample first assessment, set test scores, complete today's session, Next day, and Reset.
- Journal: the existing Administrative control and Start again actions.
- Settings: the existing exercise test bench, affected-side selection, levels, quick test, and simulated patient options.

The Render random assessment control calls `/api/assessment/review-random-results` on the assessment service. That separate endpoint accepts bounded test options, generates synthetic evidence, and uses the same pure function scorer and exercise selector as the local test control. It does not accept submitted measurements, account credentials, patient IDs, or free-text survey answers, and never reads or writes patient accounts. The existing local preview and authenticated assessment endpoints keep their original access rules.

Review test days and simulated exercise sessions count towards browser-local Journey progress and daily plan review, as they do locally. This release does not change the one-time fresh-account marker, so deploying it preserves a reviewer's new answers and progress.

Validation: 92 focused companion checks and 37 assessment checks passed; the production client and server builds passed. The unchanged Journey test suite has an existing day-15 assertion against the current twelve-day timeline; that failure was reproduced against the pre-change source. The default TypeScript command also retains the existing ES5 target issue with Set iteration; checks using the production JavaScript target cover the updated source.
