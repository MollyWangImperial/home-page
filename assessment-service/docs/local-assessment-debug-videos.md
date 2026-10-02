# Local assessment debug videos

The loopback assessment preview saves the most recent assessment in:

`D:\rh-release\backend\.local_state\assessment-debug\latest`

- `T1.webm`: seated reach, including initial camera/lap calibration.
- `T3.webm`: hand to mouth.
- `H4.webm`: hand opening.
- `H3.webm`: pinch.
- `L6.webm`, `.mp4`, `.m4v`, or `.mov`: the walking clip selected or recorded on this device.
- Matching task JSON files contain the result, step timing, and sampled target/tracking geometry. `session.json` identifies the latest run.

Camera tasks save a mirrored video with the target overlay and a debugging footer. Camera recording does not capture the microphone. Walking preserves the selected source clip. Skipped walking has no source video to save. Completed task clips save before the next task; Exit saves the current partial camera task. Closing the tab abruptly may lose its current unfinished clip.

Starting a new local assessment clears only the managed files in this latest debug folder. Older in-flight uploads are rejected, and ordinary account/history recordings use their existing storage and retention. Local debugging requires the explicit loopback preview guard and is disabled on Render. Normal successful recording adds no patient-facing status banner or extra button.

Reach layout keeps its established horizontal ordering and ignores small shoulder-tracking fluctuations. It still updates for a real seated adjustment before movement, then retains its final position and size through all three reach levels. The circles remain large and their hit regions do not overlap.

Verification: 120 selected Python checks and 174 Node checks passed, plus live served-runner replays for reach/calibration/opening/pinch/mouth and noisy shoulders. Real browser MediaRecorder tests saved five synthetic video files; FFprobe decoded 24 frames in each, with one video stream and no audio. New-session reset and stale-upload rejection were verified. Synthetic recordings were cleared from the latest folder after checking.

Existing legacy tests still assume the retired initial-package fourth task is H1 (the package now uses H4 before H3), or an earlier literal ExerciseSession wrapper. These assertions fail independently of this change and were not altered. Synthetic landmarks and videos do not establish live patient-camera performance.
