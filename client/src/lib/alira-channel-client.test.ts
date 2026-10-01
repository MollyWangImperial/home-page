import { afterEach, describe, expect, it, vi } from "vitest";
import { askAliraChannel, channelHistory } from "./alira-channel-client";

afterEach(() => vi.unstubAllGlobals());
describe("Settings conversations", () => {
  it("drops unanswered and failed questions when Zak tries again", () => {
    expect(channelHistory([
      { role: "user", text: "stopped" },
      { role: "user", text: "failed" }, { role: "assistant", text: "error", failed: true },
      { role: "user", text: "answered" }, { role: "assistant", text: "yes" },
      { role: "user", text: "next" },
    ])).toEqual([{ role: "user", text: "answered" }, { role: "assistant", text: "yes" }, { role: "user", text: "next" }]);
  });
  it("reads chunked events and the final answer, and supplies the progress context", async () => {
    const bytes = new TextEncoder().encode('data: {"type":"status","text":"Reading notes","file":"server/data/molly-progress.json"}\r\n\r\ndata: {"type":"answer","text":"Hello 🌱"}');
    const request = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } })));
    vi.stubGlobal("fetch", request);
    const onStatus = vi.fn();
    const reply = await askAliraChannel({ turns: [{ role: "user", text: "What changed?" }], signal: new AbortController().signal, context: "molly-progress", onStatus });
    expect(reply).toEqual({ text: "Hello 🌱", files: [] });
    expect(onStatus).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith({ type: "status", text: "I'm looking up the details for you." });
    expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toMatchObject({ context: "molly-progress", messages: [{ role: "user", text: "What changed?" }] });
  });
  it("reports incomplete replies and connection errors instead of showing an empty answer", async () => {
    vi.stubGlobal("fetch", async () => new Response('data: {"type":"done"}\n\n'));
    await expect(askAliraChannel({ turns: [{ role: "user", text: "Hi" }], signal: new AbortController().signal })).rejects.toThrow("interrupted");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Try later" }), { status: 503 }));
    await expect(askAliraChannel({ turns: [{ role: "user", text: "Hi" }], signal: new AbortController().signal })).rejects.toThrow("Try later");
  });
  it("never passes legacy file paths, tool names or search queries to the loading UI", async () => {
    const events = [
      { type: "status", text: "Reading client/src/lib/exercise-engine/scoring.ts from line 47", file: "client/src/lib/exercise-engine/scoring.ts", tool: "read_file" },
      { type: "status", text: 'Searching the code for "^def |^[A-Z_]+ = "', tool: "search_code" },
      { type: "status", text: "Working out an example score", tool: "score_rep" },
      { type: "answer", text: "Molly built a fixed set of scoring rules." },
    ];
    vi.stubGlobal("fetch", async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")));
    const onStatus = vi.fn();
    const answer = await askAliraChannel({ turns: [{ role: "user", text: "How do my scores work?" }], signal: new AbortController().signal, onStatus });
    expect(onStatus.mock.calls.map(([event]) => event)).toEqual(Array(3).fill({ type: "status", text: "I'm looking up the details for you." }));
    expect(answer).toEqual({ text: "Molly built a fixed set of scoring rules.", files: [] });
  });
});
