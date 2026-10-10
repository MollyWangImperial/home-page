import { expect, it } from "vitest";
import type { Side } from "./config";
import { ExerciseSession, simFrame } from "./session";

// Reduced camera measurement traces: elapsed ms, tilt delta, ear-gap reduction, ring contact.
// Keep numeric movement evidence only; the temporary patient videos are not test assets.
type Signal = [number, number, number, boolean];
const normalReach: Signal[] = [
  [0, 1.2, 0, false], [113, 2.63, 0, false], [222, 3.22, 0, false], [333, 4.37, 0, false], [442, 2.24, 0, false], [549, 4.74, 0, false],
  [659, 7.75, 0, true], [769, 8.9, 0, true], [883, 9.81, 0, true], [995, 10.88, 0, true], [1108, 10.3, 0, true], [1216, 10.1, 0, true],
  [1330, 9.99, 0, true], [1442, 10.26, 0, true], [1557, 10.14, 0, true], [1670, 10.12, 0, true], [1780, 10.63, 0, true], [1888, 10.47, 0, true],
  [1998, 9.84, 0, true], [2108, 10.22, 0, true],
];
const pronouncedHike: Signal[] = [
  [0, 1.78, 0, false], [111, 1.55, 0, false], [223, 1.78, 0, false], [335, 1.78, 0, false], [449, 2.27, 0, false], [560, 2.58, 0, false],
  [675, 3.43, 0, false], [785, 2.23, 0, false], [898, 3.17, 0, false], [1013, 2.22, 0, false], [1127, 2.76, 0, false], [1240, 3.09, 0, false],
  [1355, 3.48, 0, false], [1466, 5.93, 0, false], [1579, 9.47, 0, false], [1690, 12.08, 0, true], [1802, 16.44, 0, true], [1914, 17.9, 0, true],
  [2024, 21.69, 2.71, true], [2133, 23.31, 0, true], [2246, 25.56, 2.8, true], [2355, 28.1, 4.99, true], [2467, 29.16, 8.1, true],
  [2582, 31.39, 12.12, true], [2692, 32.18, 16.32, true], [2805, 33.58, 16.58, true], [2915, 33.83, 21.1, true], [3025, 33.78, 22.15, true], [3135, 34.07, 23.38, true],
];

it.each(["left", "right"] as Side[])("allows the recorded normal reach but preserves sustained hike detection (%s side)", side => {
  for (const [signals, expected] of [[normalReach, []], [pronouncedHike, ["shoulder_hike"]]] as const) {
    const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side, repsOverride: 1 }, { say() {}, busy: () => false, stop() {} });
    session.start(0);
    session.push(simFrame(1, session.cfg, session.targets(), { level: 0, compensations: [] }));
    session.skipAhead(2); session.skipAhead(3);
    let t = 3;
    const push = (signal?: Signal, elapsed = 100) => {
      const reaching = session.currentStep?.kind === "reach";
      const frame = simFrame(t += elapsed, session.cfg, session.targets(), { level: reaching ? 1 : 0, compensations: [] });
      // The recordings' shoulder tilt, with the trunk upright (so the tilt against the trunk is the same).
      if (signal) { frame.comps.shoulder_hike_delta = frame.comps.shoulder_hike_rel_delta = signal[1]; frame.comps.shoulder_elevation_pct = signal[2]; }
      frame.targetContact = signal ? signal[3] : true;
      session.push(frame);
    };
    for (let n = 0; n < 200 && (session.snapshot().phase === "warm" || !session.snapshot().targetArmed); n++) push();
    expect(session.snapshot().phase).toBe("reps");
    expect(session.snapshot().targetArmed).toBe(true);
    let prior = -100;
    for (const signal of signals) { push(signal, signal[0] - prior); prior = signal[0]; }
    // Complete the final contact interval, which falls between saved metadata samples.
    for (let n = 0; n < 3 && session.currentStep?.kind === "reach"; n++) push(signals.at(-1));
    for (let n = 0; n < 30 && session.snapshot().phase !== "done"; n++) push();
    expect(session.snapshot().phase).toBe("done");
    expect(session.snapshot().reps[0].compensations).toEqual(expected);
    expect(session.snapshot().reps[0].score).toBe(expected.length ? 30 : 100);
  }
});
