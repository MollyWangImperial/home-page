import { describe, expect, it } from "vitest";
import { createMollyChatStore, MOLLY_CHAT_KEY, mollyChatDay, startMollyChat, untilNextChatDay } from "./molly-daily-chat";
import { replyTo } from "./molly-progress";

const morning = new Date(2026, 9, 1, 8, 30);
const evening = new Date(2026, 9, 1, 23, 59);
const tomorrow = new Date(2026, 9, 2);
const history = { updatedAt: "2026-10-01", days: [] };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

describe("Molly's daily chat", () => {
  it("restores the exact opening and exchanges later that day, including a pending chip reply", () => {
    const disk = storage();
    const store = createMollyChatStore(() => disk);
    const chat = startMollyChat(history, morning);
    chat.messages.push({ id: "z1", from: "zak", kind: "text", text: "Show me the project heatmap" }, ...replyTo("heatmap", history));
    chat.turns = [{ role: "user", text: "What did Molly do today?" }, { role: "assistant", text: "Molly has been refining the chat." }];
    chat.draft = "And what comes next?";
    chat.scrollTop = 120;
    store.save(chat, morning);
    // A newly mounted tab/reloaded page reads the disk, not the previous component.
    expect(createMollyChatStore(() => disk).read(evening)).toEqual(chat);
  });

  it("records the complete opening before animation so an interrupted first visit cannot replay it", () => {
    const disk = storage();
    const store = createMollyChatStore(() => disk);
    expect(store.read(morning)).toBeNull();
    const chat = startMollyChat(history, morning);
    store.save(chat, morning);
    expect(store.read(morning)?.messages).toEqual(chat.messages);
    expect(chat.messages.length).toBeGreaterThan(1);
    expect(chat.messages.at(-1)?.kind).toBe("chips");
  });

  it("expires just this chat at local midnight and creates a fresh report and empty conversation", () => {
    const disk = storage();
    disk.setItem("unrelated.patient.data", "keep");
    const store = createMollyChatStore(() => disk);
    store.save({ ...startMollyChat(history, morning), turns: [{ role: "user", text: "Yesterday's question" }], draft: "Yesterday's draft" }, morning);
    expect(store.read(tomorrow)).toBeNull();
    expect(disk.getItem(MOLLY_CHAT_KEY)).toBeNull();
    expect(disk.getItem("unrelated.patient.data")).toBe("keep");
    const fresh = startMollyChat(history, tomorrow);
    expect(fresh.day).toBe("2026-10-02");
    expect(fresh.turns).toEqual([]);
    expect(fresh.draft).toBe("");
    expect(fresh.scrollTop).toBe(0);
  });

  it("ignores a late response or unmount save from the previous day", () => {
    const disk = storage();
    const store = createMollyChatStore(() => disk);
    const fresh = startMollyChat(history, tomorrow);
    store.save(fresh, tomorrow);
    store.save(startMollyChat(history, morning), tomorrow);
    expect(store.read(tomorrow)).toEqual(fresh);
  });

  it("keeps stopped questions and failed replies without restoring an in-flight state", () => {
    const disk = storage();
    const store = createMollyChatStore(() => disk);
    const chat = startMollyChat(history, morning);
    chat.turns = [{ role: "user", text: "A failed question" }, { role: "assistant", text: "Try again", failed: true }, { role: "user", text: "A stopped question" }];
    store.save(chat, morning);
    expect(store.read(evening)?.turns).toEqual(chat.turns);
    expect(store.read(evening)).not.toHaveProperty("busy");
  });

  it("rejects broken JSON and malformed cards or conversation turns safely", () => {
    const disk = storage();
    const store = createMollyChatStore(() => disk);
    for (const raw of ["{", JSON.stringify({ ...startMollyChat(history, morning), messages: [{ kind: "week", bars: null }] }), JSON.stringify({ ...startMollyChat(history, morning), turns: [{ role: "hacker", text: "bad" }] })]) {
      disk.setItem(MOLLY_CHAT_KEY, raw);
      expect(store.read(morning)).toBeNull();
    }
  });

  it("retains today's chat in memory if browser storage is unavailable", () => {
    const store = createMollyChatStore(() => { throw new Error("Blocked storage"); });
    const chat = startMollyChat(history, morning);
    store.save(chat, morning);
    expect(store.read(evening)).toEqual(chat);
    expect(store.read(tomorrow)).toBeNull();
  });

  it("also retains the latest chat when a full storage rejects writes but still permits reads", () => {
    const disk = storage();
    const old = startMollyChat(history, morning);
    disk.setItem(MOLLY_CHAT_KEY, JSON.stringify(old));
    const store = createMollyChatStore(() => ({ ...disk, setItem: () => { throw new Error("Quota"); } }));
    const latest = { ...old, draft: "Keep this draft" };
    store.save(latest, morning);
    expect(store.read(evening)).toEqual(latest);
  });

  it("uses local dates and the next calendar midnight across month/year boundaries", () => {
    for (const now of [new Date(2026, 9, 31, 23, 59, 59, 500), new Date(2026, 11, 31, 23, 59, 59, 500)]) {
      expect(untilNextChatDay(now)).toBe(500);
      const next = new Date(now.getTime() + untilNextChatDay(now));
      expect(mollyChatDay(next)).not.toBe(mollyChatDay(now));
      expect(next.getHours()).toBe(0);
    }
    const local = new Date(2026, 9, 1, 0, 1);
    expect(mollyChatDay(local)).toBe("2026-10-01");
    const next = new Date(local.getTime() + untilNextChatDay(local));
    expect(next.getDate()).toBe(2);
    expect(next.getHours()).toBe(0);
  });
});
