import { z } from "zod";
import { buildThread, type ProgressHistory, type ThreadMessage } from "./molly-progress";
import type { ChannelTurn } from "./alira-channel-client";

export const MOLLY_CHAT_KEY = "rehyn.molly.chat.v1";

export type MollyDailyChat = {
  version: 1;
  day: string;
  history: ProgressHistory;
  // Save planned messages before revealing them, so closing mid-report cannot replay it.
  messages: ThreadMessage[];
  turns: ChannelTurn[];
  draft: string;
  scrollTop: number;
};

export const mollyChatDay = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function untilNextChatDay(now = new Date()): number {
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  return Math.max(1, midnight.getTime() - now.getTime());
}

const count = z.number().finite().nonnegative();
const area = z.object({
  id: z.string(), label: z.string(), filesAdded: count, filesChanged: count,
  filesRemoved: count, linesAdded: count, linesRemoved: count, highlights: z.array(z.string()),
});
const history = z.object({
  updatedAt: z.string(), source: z.enum(["local", "published", "deployed"]).optional(),
  days: z.array(z.object({
    date: z.string(), generatedAt: z.string(), firstRun: z.boolean().optional(), quiet: z.boolean(),
    totals: z.object({ filesAdded: count, filesChanged: count, filesRemoved: count, linesAdded: count, linesRemoved: count, testFiles: count }),
    areas: z.array(area),
  })),
});
const message = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), from: z.enum(["alira", "zak"]), kind: z.literal("text"), text: z.string() }),
  z.object({ id: z.string(), from: z.literal("alira"), kind: z.literal("area"), area, title: z.string(), body: z.string(), benefit: z.string() }),
  z.object({ id: z.string(), from: z.literal("alira"), kind: z.literal("week"), caption: z.string(), bars: z.array(z.object({ date: z.string(), label: z.string(), lines: count, quiet: z.boolean() })) }),
  z.object({ id: z.string(), from: z.literal("alira"), kind: z.literal("numbers"), rows: z.array(z.object({ label: z.string(), value: z.string() })) }),
  z.object({ id: z.string(), from: z.literal("alira"), kind: z.literal("chips"), chips: z.array(z.object({ id: z.enum(["meaning", "numbers", "earlier", "thanks", "try", "heatmap"]), label: z.string() })) }),
  z.object({ id: z.string(), from: z.literal("alira"), kind: z.literal("heatmap"), progress: z.object({
    updatedAt: z.string(), note: z.string(), areas: z.array(z.object({
      id: z.enum(["exercise", "assessment", "frontend", "alira"]), label: z.string(), status: z.string(),
      completedPercent: count.max(100).nullable(), remainingPercent: count.max(100).nullable(),
      measure: z.string(), done: z.string(), next: z.string(), sources: z.array(z.string()),
    })),
  }) }),
]);
const dailyChat: z.ZodType<MollyDailyChat> = z.object({
  version: z.literal(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), history,
  messages: z.array(message),
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string(), failed: z.boolean().optional() })),
  draft: z.string().max(2000), scrollTop: count,
});

export function startMollyChat(history: ProgressHistory, now = new Date()): MollyDailyChat {
  return { version: 1, day: mollyChatDay(now), history, messages: buildThread(history, now), turns: [], draft: "", scrollTop: 0 };
}

type ChatStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** One browser-local day's conversation. Blocked storage falls back to same-tab memory. */
export function createMollyChatStore(storage: () => ChatStorage) {
  let fallback: MollyDailyChat | null = null;
  return {
    read(now = new Date()): MollyDailyChat | null {
      let saved: MollyDailyChat | null;
      try {
        const raw = storage().getItem(MOLLY_CHAT_KEY);
        const parsed = raw === null ? null : dailyChat.safeParse(JSON.parse(raw));
        saved = fallback?.day === mollyChatDay(now) ? fallback : parsed?.success ? parsed.data : null;
      } catch { saved = fallback; }
      if (saved && saved.day === mollyChatDay(now)) return saved;
      // Expired or malformed chat never becomes tomorrow's conversation.
      fallback = null;
      try { storage().removeItem(MOLLY_CHAT_KEY); } catch { /* Storage is unavailable. */ }
      return null;
    },
    save(chat: MollyDailyChat, now = new Date()): void {
      // A late answer or cleanup from yesterday must not overwrite today's chat.
      if (chat.day !== mollyChatDay(now)) return;
      fallback = chat;
      try {
        storage().setItem(MOLLY_CHAT_KEY, JSON.stringify(chat));
        fallback = null;
      } catch { /* Retain the conversation in memory when storage is blocked or full. */ }
    },
  };
}

export const mollyChatStore = createMollyChatStore(() => localStorage);
