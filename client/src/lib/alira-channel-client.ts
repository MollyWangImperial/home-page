export type ChannelTurn = { role: "user" | "assistant"; text: string; failed?: boolean };
export type ChannelStatus = { enabled: boolean; configured: boolean };
type Event = { type: "status"; text: string; file?: string } | { type: "answer"; text: string } | { type: "error"; error: string } | { type: "done" };
export type ChannelProgress = { type: "status"; text: string };

/** Keep only complete exchanges, including after a failed or stopped request. */
export function channelHistory(turns: ChannelTurn[]): ChannelTurn[] {
  const pairs: ChannelTurn[] = [];
  for (let i = 0; i < turns.length - 1; i++) {
    if (turns[i].role === "user" && turns[i + 1].role === "assistant" && !turns[i + 1].failed) {
      pairs.push(turns[i], turns[++i]);
    }
  }
  const last = turns.at(-1);
  return [...pairs.slice(-18), ...(last?.role === "user" ? [last] : [])];
}

export async function askAliraChannel({ turns, signal, context, onStatus }: {
  turns: ChannelTurn[];
  signal: AbortSignal;
  context?: "molly-progress";
  onStatus?: (event: ChannelProgress) => void;
}): Promise<{ text: string; files: string[] }> {
  const response = await fetch("/api/alira/channel", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: channelHistory(turns).map(({ role, text }) => ({ role, text })), ...(context ? { context } : {}) }),
    signal,
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "I couldn't answer that just now. Please try again.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  const consume = (part: string) => {
    const line = part.split("\n").find(line => line.startsWith("data: "));
    if (!line) return;
    const event: Event = JSON.parse(line.slice(6));
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "answer") answer = event.text;
    if (event.type === "status") {
      // Older servers can still send tool names, search terms and file paths. None of
      // that becomes display data, even when the caller renders status text directly.
      onStatus?.({ type: "status", text: "I'm looking up the details for you." });
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      parts.forEach(consume);
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    if (!answer.trim()) throw new Error("The answer got interrupted. Please ask again.");
    return { text: answer, files: [] };
  } finally { reader.releaseLock(); }
}
