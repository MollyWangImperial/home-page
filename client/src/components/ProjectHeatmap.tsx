import { PROJECT_PROGRESS, type ProjectAreaProgress } from "@shared/project-progress";

/** Twenty tiles per measured row, with exact figures alongside the colour. */
export function ProjectHeatmap({ progress = PROJECT_PROGRESS }: { progress?: typeof PROJECT_PROGRESS }) {
  return (
    <figure className="mp-card mp-heatmap" aria-label="Molly's project design heatmap">
      <figcaption>
        <h3>Molly’s project heatmap</h3>
        <p>Finished work and what comes next</p>
      </figcaption>
      <div className="mp-heatmap-legend" aria-hidden="true">
        <span><i className="mp-tile-done" />Done</span>
        <span><i className="mp-tile-left" />To review</span>
        <span><i className="mp-tile-unset" />Estimate unset</span>
      </div>
      <ul className="mp-heatmap-areas">
        {progress.areas.map(area => <HeatmapRow key={area.id} area={area} />)}
      </ul>
      <p className="mp-heatmap-note">Expand a row for completed work and next steps · {new Date(`${progress.updatedAt}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
    </figure>
  );
}

function HeatmapRow({ area }: { area: ProjectAreaProgress }) {
  const learning = area.id === "alira";
  const measured = area.completedPercent !== null && area.remainingPercent !== null;
  return (
    <li className={`mp-heatmap-area${learning ? " mp-heatmap-learning" : ""}`}>
      <div className="mp-heatmap-heading"><h4>{area.label}</h4>{!learning && <span className="mp-heatmap-status">{area.status}</span>}</div>
      <div className="mp-heatmap-tiles" aria-hidden="true">
        {Array.from({ length: 20 }, (_, index) => {
          const fill = measured ? Math.min(1, Math.max(0, area.completedPercent! / 5 - index)) * 100 : 0;
          return <i key={index} className={learning ? "mp-tile-learning" : measured ? "mp-tile-left" : "mp-tile-unset"} style={measured ? { backgroundImage: `linear-gradient(to right, #327359 ${fill}%, transparent ${fill}%)` } : undefined} />;
        })}
      </div>
      <details className="mp-heatmap-details">
        <summary aria-label={`${area.label}: ${learning ? "Keeps learning" : measured ? `${area.completedPercent}% ${area.measure}, ${area.remainingPercent}% left` : `${area.status}, percentage not estimated yet`}. Completed work and next steps`}>
          <span className="mp-heatmap-figures">{learning ? "Keeps learning" : measured ? <><strong>{area.completedPercent}% {area.id === "exercise" ? "reviewed" : "done"}</strong><span>{area.remainingPercent}% left</span></> : "Percentage not estimated yet"}</span>
        </summary>
        <p className="mp-heatmap-measure">{area.measure}</p>
        <p>{area.done}</p>
        {!learning && <p><strong>Next:</strong> {area.next}</p>}
      </details>
    </li>
  );
}
