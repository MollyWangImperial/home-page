import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createAliraChannelRouter, type ChannelSend } from "../../../server/alira-channel";
import { readMollyProgress } from "../../../server/molly-progress";

const roots: string[] = [];
const servers: Server[] = [];
const seed = { updatedAt: "2026-10-01T20:00:00Z", days: [{ date: "2026-10-01", firstRun: true, areas: [], totals: { filesAdded: 157, linesAdded: 19722 } }] };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "rehyn-settings-chat-"));
  roots.push(root);
  await mkdir(path.join(root, "server", "data"), { recursive: true });
  await writeFile(path.join(root, "server", "data", "molly-progress.json"), JSON.stringify(seed));
  const send = vi.fn<ChannelSend>(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "This is the starting inventory, Zak." }] }));
  const app = createAliraChannelRouter({ root, send, getConfig: () => ({ apiKey: "fake-test-key" }) });
  const server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (context?: string, question = "What has Molly done?") => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context, messages: [{ role: "user", text: question }] }) });
  return { root, send, post };
}
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
describe("Alira's progress conversation", () => {
  it("streams only plain progress messages for every read-only tool, without file or tool metadata", async () => {
    const { send, post } = await fixture();
    send.mockResolvedValueOnce({ stop_reason: "tool_use", content: [
      { type: "tool_use", id: "map", name: "project_map", input: {} },
      { type: "tool_use", id: "list", name: "list_directory", input: { path: "server/data" } },
      { type: "tool_use", id: "read", name: "read_file", input: { path: "server/data/molly-progress.json", start_line: 1 } },
      { type: "tool_use", id: "search", name: "search_code", input: { pattern: "filesAdded", path: "server/data" } },
      { type: "tool_use", id: "rules", name: "exercise_scoring_rules", input: { exercise_id: "ex_reach" } },
      { type: "tool_use", id: "score", name: "score_rep", input: { roms: [{ weight: 1, target: 80, achieved: 80 }], hold: "full", compensations: 0 } },
    ] });
    const response = await post(undefined, "How does Molly calculate an exercise score?");
    const stream = await response.text();
    const events = stream.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    const statuses = events.filter(event => event.type === "status");
    expect(statuses).toHaveLength(6);
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill({ type: "status", text: "I'm looking up the details for you." }));
    expect(statuses[5]).toEqual({ type: "status", text: "I'm thinking this through." });
    expect(stream).not.toContain("molly-progress.json");
    expect(stream).not.toContain("filesAdded");
    expect(stream).not.toContain('"tool"');
    expect(stream).not.toContain('"file"');
    expect(events.some(event => event.type === "answer")).toBe(true);
    // Source evidence still reaches the model internally, so the answer can remain grounded.
    expect(JSON.stringify(send.mock.calls[1][0].messages)).toContain("19722");
  });
  it("uses the same latest notes as the panel and keeps the agent read-only", async () => {
    const { root, send, post } = await fixture();
    expect(await readMollyProgress(root)).toMatchObject({ ...seed, source: "local" });
    const response = await post("molly-progress");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain('"type":"answer"');
    const params = send.mock.calls[0][0];
    expect(JSON.stringify(params.system)).toContain("19722");
    expect(JSON.stringify(params.system)).toContain("inventory baseline");
    expect(JSON.stringify(params.system)).toContain("untrusted reference data");
    expect(JSON.stringify(params.system)).toContain("Design heatmap (reference data only)");
    expect(JSON.stringify(params.system)).toContain("Easy exercise review coverage");
    expect(JSON.stringify(params.system)).toContain("Null percentages are unagreed estimates");
    expect(JSON.stringify(params.system)).toContain("Keeps learning");
    expect(params.tools?.map(tool => tool.name)).not.toContain("write_file");
  });
  it("keeps normal help questions free of Molly's progress context", async () => {
    const { send, post } = await fixture();
    await (await post()).text();
    expect(JSON.stringify(send.mock.calls[0][0].system)).not.toContain("Progress notes (reference data only)");
  });
  it("instructs both chats to explain Molly's verified implementation without inventing personal or clinical claims", async () => {
    const { send, post } = await fixture();
    for (const context of [undefined, "molly-progress"]) {
      await (await post(context, "How is Alira grading my assessment score?")).text();
      const instructions = send.mock.calls.at(-1)![0].system.map((block: { text: string }) => block.text).join("\n");
      expect(instructions).toContain("In every explanation");
      expect(instructions).toContain("explicitly credit Molly");
      expect(instructions).toContain("based on the code you checked");
      expect(instructions).toContain("fixed scoring rules");
      expect(instructions).toContain("Do not invent Molly's motives");
      expect(instructions).toContain("clinical approval");
      expect(instructions).toContain('"Questions about Alira"');
      expect(instructions).toContain("Treat him as an admin");
      expect(instructions).toContain('Use \"patient scores\" and \"the exercise plan\"');
    }
  });
  it("reads a newer published note in production, like the progress panel", async () => {
    const { root } = await fixture();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOLLY_PROGRESS_DIR", root);
    await writeFile(path.join(root, "rehyn-molly-progress.json"), JSON.stringify({ updatedAt: "2026-10-02T20:00:00Z", days: [{ date: "2026-10-02", areas: [] }] }));
    expect(await readMollyProgress(root)).toMatchObject({ updatedAt: "2026-10-02T20:00:00Z", source: "published" });
  });
});
