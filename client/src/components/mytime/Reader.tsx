import { splitSentences } from "@/lib/alira-read-aloud";

// A readable, listenable page is a list of blocks of text; the blocks are flattened into the
// sentences Alira reads, and each block knows where its first sentence falls so it can be lit.

export type ReaderBlock = { key: string; text: string };
export type Narration = { lines: string[]; starts: Record<string, number> };

/** Puts the blocks in reading order and notes where each one's first sentence falls. */
export function narrate(blocks: ReaderBlock[]): Narration {
  const lines: string[] = [];
  const starts: Record<string, number> = {};
  blocks.forEach(block => {
    starts[block.key] = lines.length;
    splitSentences(block.text).forEach(sentence => lines.push(sentence));
  });
  return { lines, starts };
}
