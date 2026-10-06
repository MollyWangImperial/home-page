import { feedPosts, isPersonId, members, pronounWords, reportReasons, type MemberId, type ReportReason } from "@/content/community-samples";
import {
  blockedList,
  daysAgoLabel,
  hiddenPostList,
  hiddenWordIn,
  isBlocked,
  isMuted,
  mutedList,
  relationship,
  type CommunityMemory,
  type CommunityStore,
  type SafetyTarget,
} from "@/lib/community-store";
import { myGroups } from "./group-model";

// What the hide, block or report sheet (PostMenu) and the Safety page share. Everything they do
// stays on this device: a report is kept in Safety, and the person it is about is never told.

/** A report reason's label and colours, as the reason cards show them. */
export function reasonOf(id: ReportReason) {
  return reportReasons.find(reason => reason.id === id) ?? reportReasons[reportReasons.length - 1];
}

export const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * A name and pronouns for sentences about someone: "He won't be told", "Unblock him any time",
 * "If they are bothering you". After a name, always write "is" ("Li Wei is blocked").
 */
export function personWords(who: MemberId) {
  const member = members[who];
  const words = pronounWords[member.pronoun];
  return { name: member.name, subject: words.subject, Subject: capital(words.subject), object: words.object, possessive: words.possessive, is: words.is };
}

/**
 * What blocking does, in three lines, the same wherever it is explained: about someone ("She can't
 * see your posts or comments", before blocking them in the sheet), or about anyone ("They can't …",
 * in the Friends drawer's Blocked tab).
 */
export function blockingFacts(who: MemberId | null): [string, string, string] {
  const Subject = who ? personWords(who).Subject : "They";
  return [
    `${Subject} can't see your posts or comments.`,
    `${Subject} can't message you or send a friend request.`,
    who ? `${Subject} won't be told. You can unblock any time.` : "They are never told that you blocked them.",
  ];
}

/** The question before unblocking someone, the same in the Friends drawer and on the Safety page. */
export function unblockQuestion(who: MemberId): string {
  const person = personWords(who);
  return `Unblock ${person.name}? You'll see ${person.possessive} posts again, and ${person.subject} can send you requests. ${person.Subject} won't be told.`;
}

/**
 * The line under someone's name in the sheet: where they are from (or when they joined), where the
 * person stands with them, and the groups they share. "Joined 2 days ago · no friends in common · not in your groups".
 */
export function aboutLine(memory: CommunityMemory, who: MemberId): string {
  const parts = [members[who].about];
  const status = relationship(memory, who);
  if (status === "friend") parts.push("your friend");
  else if (status === "incoming") parts.push("wants to be friends");
  else if (status === "sent") parts.push("you asked to be friends");
  else if (status === "blocked") parts.push("blocked");
  // Someone new here, who isn't one of the example people, has no friends in common with anyone yet.
  else if (!isPersonId(who)) parts.push("no friends in common");
  const shared = myGroups(memory).filter(group => (group.faces as MemberId[]).includes(who));
  parts.push(shared.length === 0 ? "not in your groups" : shared.length === 1 ? `in ${shared[0].name} with you` : `in ${shared.length} of your groups`);
  return parts.join(" · ");
}

/** "8:45 pm", on this device's clock. */
export function clockLabel(at: number): string {
  const time = new Date(at);
  const hour = time.getHours();
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(time.getMinutes()).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** When a report was saved: "today at 8:45 pm", "yesterday at 9:10 am", then "3 days ago" or "on 3 October". */
export function savedLabel(at: number, now = Date.now()): string {
  const day = daysAgoLabel(at, now);
  return day === "today" || day === "yesterday" ? `${day} at ${clockLabel(at)}` : day;
}

/** The words of an example post, to quote it. */
export function postText(postId: string | null): string | null {
  if (!postId) return null;
  return feedPosts.find(post => post.id === postId)?.text ?? null;
}

/** A post quoted in a report, or a note saying why its words stay out of sight. */
export type PostQuote = { text: string; covered: boolean };

/**
 * How to quote a post in the sheet and on the Safety page. The person's own settings still apply:
 * with gentle mode on, a sad post stays covered, and a post that mentions a hidden word isn't shown.
 */
export function quoteFor(memory: CommunityMemory, postId: string | null): PostQuote | null {
  const post = postId ? feedPosts.find(item => item.id === postId) : undefined;
  if (!post) return null;
  if (post.gentle && memory.settings.gentleMode) return { text: `Covered by gentle mode: ${members[post.who].name} shares ${post.gentle}.`, covered: true };
  const word = hiddenWordIn(post.text, memory.settings.hiddenWords);
  if (word) return { text: `Not shown, because it mentions “${word}”, one of your hidden words.`, covered: true };
  return { text: post.text, covered: false };
}

/** What saving a report did, for the sheet's last step. */
export type ReportOutcome = { blocked: boolean; postHidden: boolean };
export type ReportChoice = { reason: ReportReason; note: string; alsoBlock: boolean };

/**
 * Saves a report on this device. Nothing is sent, and the person it is about is not told. With
 * `alsoBlock`, they are blocked as well, so none of their posts show; without it, the post reported
 * is hidden for the person. Null if the report could not be made.
 */
export function fileReport(store: Pick<CommunityStore, "load" | "report" | "hidePost">, target: SafetyTarget, choice: ReportChoice, now = Date.now()): ReportOutcome | null {
  const wasBlocked = isBlocked(store.load(), target.who);
  const block = choice.alsoBlock && !wasBlocked;
  const made = store.report({ who: target.who, postId: target.postId, reason: choice.reason, note: choice.note, alsoBlock: block }, now);
  if (!made) return null;
  const blocked = wasBlocked || block;
  const postHidden = !blocked && made.postId !== null;
  if (postHidden && made.postId) store.hidePost(made.postId, now);
  return { blocked, postHidden };
}

/**
 * Who and what the Safety page lists, newest first in each list: blocked people (and whether their
 * posts are hidden as well), people whose posts are hidden, and single posts hidden. A post whose
 * writer is blocked or hidden is covered by that person's row, so it waits until they are not.
 */
export type SafetyLists = {
  blocked: { who: MemberId; at: number; muted: boolean }[];
  muted: { who: MemberId; at: number }[];
  posts: { postId: string; who: MemberId; at: number; quote: PostQuote }[];
};

export function safetyLists(memory: CommunityMemory, now = Date.now()): SafetyLists {
  const lists: SafetyLists = { blocked: [], muted: [], posts: [] };
  blockedList(memory, now).forEach(entry => lists.blocked.push({ who: entry.who, at: entry.at, muted: isMuted(memory, entry.who) }));
  mutedList(memory).forEach(entry => { if (!isBlocked(memory, entry.who)) lists.muted.push(entry); });
  hiddenPostList(memory).forEach(entry => {
    const post = feedPosts.find(item => item.id === entry.postId);
    const quote = quoteFor(memory, entry.postId);
    if (post && quote && !isBlocked(memory, post.who) && !isMuted(memory, post.who)) lists.posts.push({ postId: post.id, who: post.who, at: entry.at, quote });
  });
  return lists;
}
