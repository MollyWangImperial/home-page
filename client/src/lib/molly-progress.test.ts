import { describe, expect, it } from "vitest";
import { buildThread, humanize, replyTo, streakOf, tierOf, type DaySummary, type ProgressHistory } from "./molly-progress";

const area = (id: string, over: Partial<DaySummary["areas"][number]> = {}) => ({ id, label: id === "exercise" ? "Exercise coach" : "Alira's voice", filesAdded: 1, filesChanged: 2, filesRemoved: 0, linesAdded: 300, linesRemoved: 40, highlights: ["createVoice", "pickEnglishVoice"], ...over });
const day = (date: string, over: Partial<DaySummary> = {}): DaySummary => ({
  date, generatedAt: `${date}T20:00:00Z`, quiet: false,
  totals: { filesAdded: 1, filesChanged: 2, filesRemoved: 0, linesAdded: 300, linesRemoved: 40, testFiles: 2 },
  areas: [area("exercise"), area("voice")], ...over,
});
const history = (...days: DaySummary[]): ProgressHistory => ({ updatedAt: "now", days });
const evening = new Date("2026-10-01T21:00:00");
const texts = (h: ProgressHistory | null) => buildThread(h, evening).filter(m => m.kind === "text").map(m => (m as { text: string }).text);

describe("Molly's progress thread", () => {
  it("greets by time of day and explains when nothing has arrived yet", () => {
    const t = texts(null);
    expect(t[0]).toBe("Good evening, Zak.");
    expect(t.join(" ")).toContain("8");
  });

  it("tells day one as a diary start, not as work done", () => {
    const h = history(day("2026-10-01", { firstRun: true }));
    const t = texts(h).join(" ");
    expect(t).toContain("day one");
    expect(buildThread(h, evening).some(m => m.kind === "area")).toBe(false);
  });

  it("shows area cards, a week chart and quick replies for a busy day", () => {
    const thread = buildThread(history(day("2026-10-01"), day("2026-09-30")), evening);
    expect(thread.filter(m => m.kind === "area")).toHaveLength(2);
    expect(thread.some(m => m.kind === "week")).toBe(true);
    const chips = thread.find(m => m.kind === "chips");
    expect(chips && chips.kind === "chips" && chips.chips.map(c => c.id)).toEqual(["meaning", "heatmap", "try"]);
  });

  it("says a quiet day is quiet and never invents work", () => {
    const quiet = day("2026-10-01", { quiet: true, areas: [], totals: { filesAdded: 0, filesChanged: 0, filesRemoved: 0, linesAdded: 0, linesRemoved: 0, testFiles: 0 } });
    const thread = buildThread(history(quiet, day("2026-09-30")), evening);
    expect(texts(history(quiet)).join(" ")).toContain("quiet");
    expect(thread.some(m => m.kind === "area")).toBe(false);
  });

  it("is deterministic for the same day", () => {
    expect(texts(history(day("2026-10-01")))).toEqual(texts(history(day("2026-10-01"))));
  });

  it("offers the heatmap without diary data and separates it from code-change totals", () => {
    const chips = buildThread(null, evening).find(m => m.kind === "chips");
    expect(chips?.kind === "chips" && chips.chips.map(c => c.id)).toContain("heatmap");
    const reply = replyTo("heatmap", null, evening);
    const heatmap = reply.find(m => m.kind === "heatmap");
    expect(heatmap?.kind === "heatmap" && heatmap.progress.areas).toHaveLength(4);
    expect(heatmap).toEqual(replyTo("heatmap", history(day("2026-10-01", { totals: { filesAdded: 999, filesChanged: 0, filesRemoved: 0, linesAdded: 999999, linesRemoved: 0, testFiles: 0 } })), evening).find(m => m.kind === "heatmap"));
    const followups = reply.find(m => m.kind === "chips");
    expect(followups?.kind === "chips" && followups.chips.length).toBeLessThanOrEqual(3);
  });

  it("counts streaks of consecutive busy days", () => {
    expect(streakOf([day("2026-10-01"), day("2026-09-30"), day("2026-09-29")])).toBe(3);
    expect(streakOf([day("2026-10-01"), day("2026-09-29")])).toBe(1);
  });

  it("tiers the day by lines changed", () => {
    expect(tierOf(day("d", { totals: { filesAdded: 0, filesChanged: 1, filesRemoved: 0, linesAdded: 20, linesRemoved: 5, testFiles: 0 } }))).toBe("small");
    expect(tierOf(day("d", { totals: { filesAdded: 0, filesChanged: 1, filesRemoved: 0, linesAdded: 3000, linesRemoved: 100, testFiles: 0 } }))).toBe("huge");
  });

  it("humanizes code names and answers quick replies from the data", () => {
    expect(humanize("pickEnglishVoice")).toBe("pick english voice");
    const h = history(day("2026-10-01"));
    expect(replyTo("meaning", h, evening).length).toBeGreaterThan(2);
    const numbers = replyTo("numbers", h, evening)[0];
    expect(numbers.kind === "numbers" && numbers.rows[0]).toEqual({ label: "New pieces", value: "1" });
  });
});
