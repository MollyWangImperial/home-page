import {
  groupThemes,
  sampleGroups,
  startedGroupChallenge,
  suggestedGroups,
  type GroupCover,
  type GroupMessage,
  type PersonId,
  type SampleGroup,
  type SampleGroupId,
  type SuggestedGroupId,
  type ThemeId,
} from "@/content/community-samples";
import type { CommunityMemory, StartedGroup } from "@/lib/community-store";

/** The cover a started group wears: its theme's drawing, or its colour and sign. */
export function coverForTheme(theme: ThemeId): GroupCover {
  const look = groupThemes.find(item => item.id === theme) ?? groupThemes[groupThemes.length - 1];
  return look.image ? { image: look.image, tint: look.tint, ink: look.ink } : { tint: look.tint, ink: look.ink, icon: look.id };
}

/** One group as My groups shows it, whether it is an example, joined, or started by the person. */
export type GroupModel = {
  id: string;
  name: string;
  kind: "sample" | "joined" | "started";
  cover: GroupCover;
  tint: string;
  ink: string;
  meta: string;
  online: number;
  faces: PersonId[];
  challenge: { text: string; done: number; total: number };
  messages: GroupMessage[];
  incoming: GroupMessage | null;
  unread: number;
  active: boolean;
  started: StartedGroup | null;
};

function fromSample(group: SampleGroup, kind: "sample" | "joined", memory: CommunityMemory): GroupModel {
  return {
    id: group.id, name: group.name, kind, cover: group.cover, tint: group.tint, ink: group.ink,
    meta: `${group.members} members`, online: group.online, faces: group.faces, challenge: group.challenge,
    messages: group.messages, incoming: group.incoming,
    unread: memory.read.includes(group.id as SampleGroupId) ? 0 : group.unread, active: group.active, started: null,
  };
}

function fromStarted(group: StartedGroup): GroupModel {
  const look = groupThemes.find(item => item.id === group.theme) ?? groupThemes[0];
  return {
    id: group.id, name: group.name, kind: "started", cover: coverForTheme(group.theme),
    tint: look.tint, ink: look.ink,
    meta: `Started by you · ${group.open ? "anyone can ask to join" : "invite only"}`, online: 0, faces: group.friends,
    challenge: { text: startedGroupChallenge, done: 0, total: 1 }, messages: [], incoming: null, unread: 0, active: false, started: group,
  };
}

/** The person's groups: the ones they started (newest first), the examples, then any they joined. */
export function myGroups(memory: CommunityMemory): GroupModel[] {
  const joined = suggestedGroups.filter(group => memory.joined.includes(group.id as SuggestedGroupId));
  return [...memory.started.map(fromStarted), ...sampleGroups.map(group => fromSample(group, "sample", memory)), ...joined.map(group => fromSample(group, "joined", memory))];
}

/**
 * The last line said in a group, for its row in the list: the newest of the person's own messages,
 * a message that arrived during this visit, or the group's latest example message.
 */
export function lastLine(group: GroupModel, memory: CommunityMemory, deliveredAt: number | null, name: (who: PersonId) => string): string {
  const lines: { at: number; text: string }[] = [];
  (memory.messages[group.id] ?? []).forEach(note => lines.push({ at: note.createdAt, text: `You: ${note.text || "a photo"}` }));
  if (deliveredAt !== null && group.incoming) lines.push({ at: deliveredAt, text: `${name(group.incoming.who)}: ${group.incoming.text}` });
  if (group.started?.hello) lines.push({ at: group.started.createdAt, text: `You: ${group.started.hello}` });
  if (lines.length) return lines.reduce((newest, line) => (line.at >= newest.at ? line : newest)).text;
  const last = group.messages[group.messages.length - 1];
  return last ? `${name(last.who)}: ${last.text}` : "Just you for now. Say hello";
}
