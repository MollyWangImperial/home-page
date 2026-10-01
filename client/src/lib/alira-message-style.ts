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

/** Dots first, then Unicode characters, then completion. Leaving cancels every pending step. */
export async function presentAliraMessage(text: string, callbacks: {
  onThinking: (thinking: boolean) => void;
  onMessage: (characters: AliraCharacter[]) => void;
  onFrame?: (visible: string) => void;
}, signal: AbortSignal, reducedMotion = aliraReducedMotion()) {
  signal.throwIfAborted();
  if (reducedMotion) {
    callbacks.onThinking(false);
    callbacks.onMessage([]);
    callbacks.onFrame?.(text);
    return;
  }
  callbacks.onThinking(true);
  await pause(ALIRA_MESSAGE_STYLE.thinkingMs, signal);
  const { chars, total } = aliraCharacters(text);
  callbacks.onThinking(false);
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
}
