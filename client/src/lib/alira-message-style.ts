/** The shared rhythm for a newly delivered Alira chat message. */
export const ALIRA_MESSAGE_STYLE = { thinkingMs: 800, characterMs: 24, commaMs: 150, sentenceMs: 300, settleMs: 150 } as const;
export type AliraCharacter = { ch: string; d: number };

export function aliraCharacters(text: string) {
  const chars: AliraCharacter[] = [];
  let total = 0;
  for (const ch of text) {
    chars.push({ ch, d: total });
    total += /[.!?]/.test(ch) ? ALIRA_MESSAGE_STYLE.sentenceMs : ch === "," ? ALIRA_MESSAGE_STYLE.commaMs : ALIRA_MESSAGE_STYLE.characterMs;
  }
  return { chars, total };
}

export function aliraReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * The patient's pause on Alira's lines, so they can ask something at once: while it is closed, a new line waits
 * before it starts, a line still thinking waits before it shows, and a line shown waits before it completes (so
 * nothing that follows it, a line or its buttons, comes until it opens).
 */
export type AliraHold = { readonly closed: boolean; close(): void; open(): void; wait(signal: AbortSignal): Promise<void> };

export function createAliraHold(): AliraHold {
  let closed = false;
  let waiting: (() => void)[] = [];
  return {
    get closed() { return closed; },
    close() { closed = true; },
    open() {
      closed = false;
      const ready = waiting;
      waiting = [];
      ready.forEach(go => go());
    },
    wait(signal) {
      if (!closed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        const go = () => { signal.removeEventListener("abort", abort); resolve(); };
        const abort = () => { waiting = waiting.filter(waiter => waiter !== go); reject(signal.reason); };
        waiting.push(go);
        signal.addEventListener("abort", abort, { once: true });
      });
    },
  };
}

/** Dots first, then Unicode characters, then completion. Leaving cancels every pending step; `hold` pauses them. */
export async function presentAliraMessage(text: string, callbacks: {
  onThinking: (thinking: boolean) => void;
  onMessage: (characters: AliraCharacter[]) => void;
  onFrame?: (visible: string) => void;
}, signal: AbortSignal, reducedMotion = aliraReducedMotion(), hold?: AliraHold) {
  signal.throwIfAborted();
  if (hold) await hold.wait(signal);
  if (reducedMotion) {
    callbacks.onThinking(false);
    callbacks.onMessage([]);
    callbacks.onFrame?.(text);
    if (hold) await hold.wait(signal);
    return;
  }
  callbacks.onThinking(true);
  await pause(ALIRA_MESSAGE_STYLE.thinkingMs, signal);
  callbacks.onThinking(false);
  // Paused while thinking: the dots have gone, and the line waits to show.
  if (hold?.closed) await hold.wait(signal);
  const { chars, total } = aliraCharacters(text);
  callbacks.onMessage(chars);
  if (callbacks.onFrame) {
    let visible = "";
    for (let index = 0; index < chars.length; index++) {
      signal.throwIfAborted();
      visible += chars[index].ch;
      callbacks.onFrame(visible);
      const next = chars[index + 1]?.d ?? total;
      await pause(next - chars[index].d, signal);
    }
    await pause(ALIRA_MESSAGE_STYLE.settleMs, signal);
  } else await pause(total + ALIRA_MESSAGE_STYLE.settleMs, signal);
  signal.throwIfAborted();
  if (hold) await hold.wait(signal);
}
