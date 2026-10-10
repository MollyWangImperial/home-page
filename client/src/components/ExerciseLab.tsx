import { useState } from "react";
import { Activity, ChevronRight, Hand, Play } from "lucide-react";
import { DOMAIN_LABEL, EXERCISE_RUNGS, EXERCISES, LAUNCH_EXERCISE_IDS, SOLO_EXCLUDED_IDS, type Domain, type Rung } from "@/lib/exercise-engine/config";
import { metricUnitName } from "@/lib/exercise-engine/calibration";
import "@/pages/exercise-engine.css";
import { clearLabSessions, readLabOptions, readLabSessions, writeLabOptions, type LabOptions } from "@/lib/exercise-engine/lab-storage";

const DOMAINS: Domain[] = ["upper_limb", "hand", "lower_limb"];

/** A level target in its own unit: degrees for angles, shoulder widths for the slide and carry. */
const targetText = (value: number, metric: string) => {
  const unit = metricUnitName(metric);
  return unit.startsWith("degrees") ? `${value}°` : unit.startsWith("percent") ? `${value}%` : `${value} ${unit}`;
};

/** Settings panel: open each launch exercise on its own, at any rung, to test it one by one. */
export function ExerciseLabPanel({ onLaunch }: { onLaunch: (path: string) => void }) {
  const [options, setOptions] = useState<LabOptions>(readLabOptions);
  const [rungs, setRungs] = useState<Record<string, Rung>>({});
  const [sessions, setSessions] = useState(readLabSessions);
  const update = (patch: Partial<LabOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    writeLabOptions(next);
  };
  const launch = (id: string) => {
    const rung = rungs[id] ?? 2;
    const q = new URLSearchParams({ rung: String(rung), side: options.side, quick: options.quick ? "1" : "0", sim: options.sim ? "1" : "0", chair: options.chairBack ? "1" : "0" });
    onLaunch(`/exercise/${id}?${q.toString()}`);
  };

  return (
    <div className="xe-lab">
      <p className="settings-document-intro">
        Test bench for the daily exercise engine. Open any of the 8 launch exercises, pick its level, and run the full six-beat session: camera check, show-me demo, practice rep, scored reps, rescue, wrap-up. Tomorrow's level changes (the adaptation engine) are not included yet.
      </p>

      <section className="xe-lab-options" aria-label="Test options">
        <label><span>Affected side</span>
          <select value={options.side} onChange={e => update({ side: e.target.value as LabOptions["side"] })}><option value="right">Right</option><option value="left">Left</option></select>
        </label>
        <label className="xe-lab-check"><input type="checkbox" checked={options.quick} onChange={e => update({ quick: e.target.checked })} /> Quick test (3 reps instead of 6 / 8 / 10)</label>
        <label className="xe-lab-check"><input type="checkbox" checked={options.sim} onChange={e => update({ sim: e.target.checked })} /> No camera: simulate a patient</label>
        <label className="xe-lab-check"><input type="checkbox" checked={options.chairBack} onChange={e => update({ chairBack: e.target.checked })} /> Forward reach in chair-back mode</label>
      </section>

      {DOMAINS.map(domain => (
        <section key={domain} className="xe-lab-group" aria-labelledby={`xe-${domain}`}>
          <h3 id={`xe-${domain}`}>{DOMAIN_LABEL[domain]}</h3>
          {LAUNCH_EXERCISE_IDS.filter(id => EXERCISES[id].domain === domain).map(id => {
            const ex = EXERCISES[id];
            const rung = rungs[id] ?? 2;
            const spec = EXERCISE_RUNGS[id][rung];
            return (
              <article key={id} className="xe-lab-card">
                <div className="xe-lab-head">
                  <span className="xe-lab-icon" aria-hidden="true">{ex.domain === "hand" ? <Hand size={19} /> : <Activity size={19} />}</span>
                  <div>
                    <h4>{ex.name}</h4>
                    <p>{ex.dailyTask} · {ex.chain}</p>
                  </div>
                </div>
                <dl>
                  <div><dt>Camera</dt><dd>{ex.framing}</dd></div>
                  <div><dt>Targets at level {rung}</dt><dd>{ex.romSteps.map(rom => `${rom.label} ${targetText(spec.targets[rom.id], rom.metric)}`).join(" · ")}{spec.oppositions ? ` · ${spec.oppositions} finger pinch${spec.oppositions > 1 ? "es" : ""}` : ""}</dd></div>
                  <div><dt>Dose</dt><dd>{options.quick ? 3 : spec.reps} reps · hold ×{spec.holdScale}</dd></div>
                </dl>
                <div className="xe-lab-actions">
                  <div className="xe-lab-rungs" role="radiogroup" aria-label={`${ex.name} level`}>
                    {([1, 2, 3] as Rung[]).map(r => (
                      <button key={r} role="radio" aria-checked={rung === r} className={rung === r ? "is-on" : ""} onClick={() => setRungs(v => ({ ...v, [id]: r }))}>Level {r}</button>
                    ))}
                  </div>
                  <button className="xe-lab-open" onClick={() => launch(id)}><Play size={15} aria-hidden="true" /> Open <ChevronRight size={15} aria-hidden="true" /></button>
                </div>
              </article>
            );
          })}
        </section>
      ))}

      <section className="xe-lab-group">
        <h3>Recent test sessions</h3>
        {sessions.length === 0 ? <p className="xe-lab-empty">Nothing yet. Finished sessions appear here (kept in this browser only).</p> : (
          <>
            <ul className="xe-lab-history">
              {sessions.slice(0, 8).map(s => (
                <li key={s.finished_at}>
                  <b>{EXERCISES[s.exercise_id]?.name ?? s.exercise_id}</b>
                  <span>{s.not_attempted ? "skipped" : `score ${s.score} · ${s.quality_reps}/${s.reps_planned} good`} · level {s.rung_start}{s.rung_end !== s.rung_start ? `→${s.rung_end}` : ""}{s.sim ? " · simulated" : ""}</span>
                </li>
              ))}
            </ul>
            <button className="xe-lab-clear" onClick={() => { clearLabSessions(); setSessions([]); }}>Clear history</button>
          </>
        )}
      </section>

      <p className="xe-lab-foot">Left out of the solo set: {SOLO_EXCLUDED_IDS.length} library exercises (trunk-restrained reach is now the chair-back mode of forward reach; the rest are therapist-set).</p>
    </div>
  );
}
