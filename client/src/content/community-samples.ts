// Sample content for the My community preview. Every person, post, group, message, poll and
// number here is invented. The page says so beside its heading, and nothing a person does on it
// leaves their device. The pictures are small drawings kept in /public/community.

const art = (id: string) => `/community/${id}.svg`;

export type PersonId = "margaret" | "david" | "tomasz" | "anne" | "priya" | "samuel" | "joan" | "liwei";
export type Person = { id: PersonId; name: string; face: string; tint: string; about: string };

export const people: Record<PersonId, Person> = {
  margaret: { id: "margaret", name: "Margaret", face: art("e5f035b22084e040992a2bae4853b87a"), tint: "#F3D9CC", about: "Leeds" },
  david: { id: "david", name: "David", face: art("5ae96ba6c0a7a4ce0abdacea5662d031"), tint: "#CFE2D6", about: "Walks with Biscuit, his dog" },
  tomasz: { id: "tomasz", name: "Tomasz", face: art("dc2c2621058c2e3cafb744564f6e0b9c"), tint: "#D5E1E6", about: "New this week" },
  anne: { id: "anne", name: "Anne", face: art("762f84e9e300103ccc005eaa89800ca5"), tint: "#FBEBC2", about: "Bath" },
  priya: { id: "priya", name: "Priya", face: art("abfddd7f2a1894d89beeac20f7fbbedb"), tint: "#E9E2F4", about: "Leicester" },
  samuel: { id: "samuel", name: "Samuel", face: art("a9469e8bfd054c29a713033e9eac24f0"), tint: "#DCECF4", about: "One-handed cooks" },
  joan: { id: "joan", name: "Joan", face: art("d6d1ced4c77f6cb92d063a301a9f70b2"), tint: "#F6DDD3", about: "Garden gang" },
  liwei: { id: "liwei", name: "Li Wei", face: art("6fae8d2a2b78d33e738f97964301ed6b"), tint: "#E3EFE6", about: "Kitchen singalong" },
};
export const PERSON_IDS: PersonId[] = ["margaret", "david", "tomasz", "anne", "priya", "samuel", "joan", "liwei"];

export type SamplePhoto = { src: string; alt: string; tint: string };
export const photos = {
  tomatoes: { src: art("040900486d4ce34d68fd29407eb0c2f7"), alt: "Tomato plants in pots on a sunny windowsill", tint: "#F7E7C6" },
  dog: { src: art("461a30320ec936927d678a9926b05791"), alt: "A dog on a lead in the park", tint: "#EFEBE2" },
} satisfies Record<string, SamplePhoto>;

/** The one-tap ways to join in, so nobody has to type to take part. */
export type ReactionKind = "love" | "welldone" | "metoo" | "withyou";
export const REACTION_KINDS: ReactionKind[] = ["love", "welldone", "metoo", "withyou"];
export const reactionLabels: Record<ReactionKind, string> = { love: "Love", welldone: "Well done", metoo: "Me too", withyou: "With you" };

export type FeelingId = "hopeful" | "proud" | "calm" | "tired" | "low" | "frustrated";
export const feelings: { id: FeelingId; label: string }[] = [
  { id: "hopeful", label: "Hopeful" },
  { id: "proud", label: "Proud" },
  { id: "calm", label: "Calm" },
  { id: "tired", label: "Tired" },
  { id: "low", label: "Low" },
  { id: "frustrated", label: "Frustrated" },
];
export const FEELING_IDS: FeelingId[] = feelings.map(feeling => feeling.id);

/* ------------------------------------------------------------------ groups */

export type SampleGroupId = "garden" | "walk" | "cook" | "music";
export type SuggestedGroupId = "knit" | "book";
export type CommunityGroupId = SampleGroupId | SuggestedGroupId;
export type ThemeId = "gardening" | "walking" | "cooking" | "music" | "books" | "family" | "crafts" | "chatting";

/** A cover is a drawing, or a colour with a letter or a theme's sign on it. */
export type GroupCover = { image?: string; tint: string; ink: string; initial?: string; icon?: ThemeId };
export type GroupMessage = { id: string; who: PersonId; text: string; note?: string; photo?: SamplePhoto; hearts: number };
export type SampleGroup = {
  id: CommunityGroupId;
  name: string;
  cover: GroupCover;
  /** The challenge strip's colour, and the ink drawn on it (dark enough to read on both). */
  tint: string;
  ink: string;
  members: number;
  online: number;
  faces: PersonId[];
  unread: number;
  /** Something is happening there now: a small live dot on its cover. */
  active: boolean;
  challenge: { text: string; done: number; total: number };
  messages: GroupMessage[];
  /** One message that arrives while the group is open, after a moment of "is writing". */
  incoming: GroupMessage;
  /** What the feed's "My groups" card shows under the name. */
  preview?: string;
  /** Why a group is suggested. */
  why?: string;
};

export const sampleGroups: SampleGroup[] = [
  {
    id: "garden", name: "Garden gang",
    cover: { image: art("fb2175989c4397ad5f421824e41a5e87"), tint: "#CFE8C9", ink: "#1C4A3C" },
    tint: "#E1F0DC", ink: "#24694B", members: 6, online: 3, faces: ["margaret", "joan", "anne", "samuel"], unread: 3, active: true,
    challenge: { text: "This week: a photo of something growing", done: 4, total: 6 },
    messages: [
      { id: "g1", who: "anne", text: "Morning, gardeners. Anyone's sweet peas up yet?", hearts: 2 },
      { id: "g2", who: "margaret", text: "First tomatoes! Left hand did the picking.", photo: { ...photos.tomatoes, alt: "Tomato plants on a sunny windowsill" }, hearts: 11 },
      { id: "g3", who: "joan", text: "Mine are still green. I'm not jealous at all.", hearts: 5 },
    ],
    incoming: { id: "g4", who: "samuel", text: "Tomato tart recipe going in One-handed cooks tonight!", hearts: 3 },
    preview: "Margaret: First tomatoes!",
  },
  {
    id: "walk", name: "Morning walkers",
    cover: { image: art("41e5e4e8b1bf6c9bbe7330cc69485ef5"), tint: "#CFE6F2", ink: "#1F4E66" },
    tint: "#DCECF4", ink: "#1F4E66", members: 8, online: 2, faces: ["david", "tomasz", "priya", "liwei"], unread: 0, active: false,
    challenge: { text: "This week: one walk a little further than last week", done: 5, total: 8 },
    messages: [
      { id: "w1", who: "david", text: "Biscuit and I made it to the corner shop and back.", photo: { ...photos.dog, alt: "A dog on a lead walking in a park" }, hearts: 14 },
      { id: "w2", who: "tomasz", text: "Can I join you tomorrow? I can do the first bit.", hearts: 6 },
    ],
    incoming: { id: "w3", who: "david", text: "Of course! 7 at the park gate. We go at your pace.", hearts: 4 },
    preview: "David: 7 tomorrow?",
  },
  {
    id: "cook", name: "One-handed cooks",
    cover: { image: art("91162a45a080841062c0f9de0b0bc8fd"), tint: "#FBE3B8", ink: "#6B5108" },
    tint: "#FBEBC2", ink: "#6B5108", members: 11, online: 1, faces: ["samuel", "priya", "margaret", "anne"], unread: 0, active: false,
    challenge: { text: "This week: share one recipe you can make one-handed", done: 3, total: 11 },
    messages: [
      { id: "c1", who: "samuel", text: "Tip: a wet tea towel under the bowl stops it sliding.", hearts: 18 },
      { id: "c2", who: "priya", text: "Game changer. Made dal yesterday all by myself.", hearts: 9 },
    ],
    incoming: { id: "c3", who: "anne", text: "Does anyone have a good rocker knife to recommend?", hearts: 1 },
  },
  {
    id: "music", name: "Kitchen singalong",
    cover: { image: art("242c86dad4e267c11919a79438078c19"), tint: "#E4DAF3", ink: "#45357A" },
    tint: "#E9E2F4", ink: "#45357A", members: 5, online: 2, faces: ["priya", "joan", "liwei"], unread: 1, active: false,
    challenge: { text: "This week: sing one whole chorus out loud", done: 2, total: 5 },
    messages: [
      { id: "m1", who: "priya", text: "Sang the whole chorus this morning. The neighbours have my sympathy.", hearts: 12 },
      { id: "m2", who: "joan", text: "Tomorrow's song: Que Sera, Sera. Who's in?", hearts: 4 },
    ],
    incoming: { id: "m3", who: "liwei", text: "I'm in. My grandson will judge us.", hearts: 2 },
  },
];

export const suggestedGroups: SampleGroup[] = [
  {
    id: "knit", name: "Knit and natter", why: "Joan and 6 others",
    cover: { tint: "#FBEBC2", ink: "#6B5108", initial: "K" },
    tint: "#FBEBC2", ink: "#6B5108", members: 7, online: 1, faces: ["joan", "anne", "margaret"], unread: 0, active: false,
    challenge: { text: "This week: cast on a few stitches, any colour", done: 2, total: 7 },
    messages: [
      { id: "k1", who: "joan", text: "Finished a whole row without dropping a stitch!", hearts: 6 },
      { id: "k2", who: "anne", text: "That's the hardest bit. Well done, Joan.", hearts: 3 },
    ],
    incoming: { id: "k3", who: "margaret", text: "Bringing my scarf to show you all tomorrow.", hearts: 2 },
  },
  {
    id: "book", name: "One chapter club", why: "One chapter a week, together",
    cover: { tint: "#F6DDD3", ink: "#8F3520", initial: "O" },
    tint: "#F6DDD3", ink: "#8F3520", members: 4, online: 1, faces: ["anne", "liwei", "samuel"], unread: 0, active: false,
    challenge: { text: "This week: read one chapter of any book", done: 1, total: 4 },
    messages: [
      { id: "b1", who: "anne", text: "Large print copies are on the library shelf by the door.", hearts: 4 },
      { id: "b2", who: "liwei", text: "I listened to mine as an audiobook. That counts!", hearts: 7 },
    ],
    incoming: { id: "b3", who: "samuel", text: "Chapter three done. Slowly, but done.", hearts: 3 },
  },
];

export const SAMPLE_GROUP_IDS: SampleGroupId[] = ["garden", "walk", "cook", "music"];
export const SUGGESTED_GROUP_IDS: SuggestedGroupId[] = ["knit", "book"];

/* ---------------------------------------------------------- start a group */

export type GroupTheme = { id: ThemeId; label: string; names: [string, string, string]; image?: string; tint: string; ink: string };
export const groupThemes: GroupTheme[] = [
  { id: "gardening", label: "Gardening", names: ["Garden gang", "Green fingers", "Windowsill growers"], image: art("fb2175989c4397ad5f421824e41a5e87"), tint: "#CFE8C9", ink: "#1C4A3C" },
  { id: "walking", label: "Walking", names: ["Morning walkers", "One step club", "Round the block"], image: art("41e5e4e8b1bf6c9bbe7330cc69485ef5"), tint: "#CFE6F2", ink: "#1F4E66" },
  { id: "cooking", label: "Cooking", names: ["One-handed cooks", "Sunday roast club", "Kitchen table"], image: art("91162a45a080841062c0f9de0b0bc8fd"), tint: "#FBE3B8", ink: "#6B5108" },
  { id: "music", label: "Music", names: ["Kitchen singalong", "Golden oldies", "Radio friends"], image: art("242c86dad4e267c11919a79438078c19"), tint: "#E4DAF3", ink: "#45357A" },
  { id: "books", label: "Books", names: ["Slow readers", "One chapter club", "Large print gang"], tint: "#F6DDD3", ink: "#8F3520" },
  { id: "family", label: "Family", names: ["Proud grandparents", "Family album", "School run crew"], tint: "#FBE3DB", ink: "#8F3520" },
  { id: "crafts", label: "Crafts", names: ["Knit and natter", "Makers corner", "Paint club"], tint: "#FBEBC2", ink: "#6B5108" },
  { id: "chatting", label: "Just chatting", names: ["Tea and a natter", "The regulars", "Night owls"], tint: "#E3EFE6", ink: "#1C4A3C" },
];
export const THEME_IDS: ThemeId[] = groupThemes.map(theme => theme.id);
/** The example friends who can be asked along, and the two ticked to begin with. */
export const inviteFriends: PersonId[] = ["margaret", "joan", "anne", "david", "priya", "samuel"];
export const defaultInvites: PersonId[] = ["margaret", "joan"];
export const groupHellos = ["Hello everyone!", "Welcome to the group.", "Who has news?"];
export const startedGroupChallenge = "This week: share one thing that made you smile";
export const GROUP_NAME_LIMIT = 40;

/* -------------------------------------------------------------------- feed */

export type SampleComment = { who: PersonId; text: string };
export type SamplePost = {
  id: string;
  who: PersonId;
  group?: SampleGroupId;
  where: string;
  when: string;
  /** What the post says. For a voice note, these are the words written underneath it. */
  text: string;
  photo?: SamplePhoto;
  voice?: { seconds: number };
  win?: boolean;
  reactions: { kind: ReactionKind; count: number }[];
  comments: SampleComment[];
  /** Show the latest comment under the post before the thread is opened. */
  peek?: boolean;
  /** Replies that can be sent with one tap. */
  quickReplies: string[];
};

export const feedPosts: SamplePost[] = [
  {
    id: "p-margaret", who: "margaret", group: "garden", where: "Leeds", when: "20 minutes ago",
    text: "First tomatoes off the windowsill! Picked them with my left hand, thank you very much.",
    photo: photos.tomatoes,
    reactions: [{ kind: "love", count: 24 }, { kind: "welldone", count: 11 }, { kind: "metoo", count: 3 }],
    comments: [
      { who: "joan", text: "Left hand doing the picking! That's brilliant." },
      { who: "anne", text: "They look lovely. Mine are still green." },
      { who: "samuel", text: "Tomato tart on the way, I hope." },
      { who: "priya", text: "Well done you, Margaret." },
      { who: "liwei", text: "My grandson would eat the lot." },
      { who: "david", text: "Save me one, Margaret." },
    ],
    peek: true,
    quickReplies: ["Lovely!", "Well done!", "Save me one!"],
  },
  {
    id: "p-tomasz", who: "tomasz", where: "New here", when: "1 hour ago",
    text: "First week home. A bit scared, if I'm honest. What helped you settle in?",
    reactions: [{ kind: "withyou", count: 18 }, { kind: "metoo", count: 7 }],
    comments: [
      { who: "anne", text: "My first week was the hardest too. It does get lighter, promise." },
      { who: "david", text: "Come walking with us. Biscuit loves new people." },
      { who: "margaret", text: "Little routines helped me. Tea at the same time each morning." },
      { who: "priya", text: "Be gentle with yourself. Resting counts as doing something." },
      { who: "joan", text: "I wrote down one good thing each night. It helped more than I expected." },
      { who: "samuel", text: "Let people help with the small jobs. They want to." },
      { who: "liwei", text: "Welcome, Tomasz. You're not on your own here." },
      { who: "anne", text: "Pop into the lounge whenever you like. Someone's always about." },
      { who: "margaret", text: "We're glad you're here." },
    ],
    quickReplies: ["Welcome, Tomasz.", "You're not alone.", "One day at a time."],
  },
  {
    id: "p-priya", who: "priya", group: "music", where: "Leicester", when: "2 hours ago",
    text: "Sang the whole chorus this morning, start to finish. The words came slowly, but every one of them came out.",
    voice: { seconds: 12 },
    reactions: [{ kind: "welldone", count: 12 }, { kind: "love", count: 8 }],
    comments: [
      { who: "joan", text: "Que Sera, Sera next?" },
      { who: "liwei", text: "Every word! Wonderful." },
      { who: "margaret", text: "I'd have loved to hear it." },
    ],
    quickReplies: ["Wonderful!", "Well done!", "Sing it again!"],
  },
  {
    id: "p-joan", who: "joan", where: "Whitby", when: "3 hours ago",
    text: "Buttoned my own cardigan this morning. All five buttons. It took ten minutes and I didn't mind one bit.",
    win: true,
    reactions: [{ kind: "welldone", count: 15 }, { kind: "love", count: 9 }, { kind: "metoo", count: 4 }],
    comments: [
      { who: "margaret", text: "All five! Well done, Joan." },
      { who: "anne", text: "Buttons are the worst. Brilliant." },
      { who: "samuel", text: "Ten minutes well spent." },
      { who: "priya", text: "Me too, last week. Such a good feeling." },
    ],
    quickReplies: ["Well done, Joan!", "Me too!", "Brilliant!"],
  },
];
export const FEED_POST_IDS = feedPosts.map(post => post.id);

/* ------------------------------------------------------------------ lounge */

export type LoungeMessage = GroupMessage;
export type LoungeEvent =
  | { kind: "typing"; who: PersonId }
  | { kind: "message"; message: LoungeMessage }
  | { kind: "arrive"; who: PersonId; text: string };
export type QuickTone = "mint" | "blue" | "amber" | "lilac" | "rose";
export type PollOption = { id: string; label: string; votes: number; fill: string };

export const lounge = {
  here: 14,
  /** One event every this many milliseconds, until the script has run. */
  everyMs: 2600,
  starter: "What are you looking forward to this week?",
  faces: ["margaret", "david", "anne", "priya"] as PersonId[],
  messages: [
    { id: "l1", who: "margaret", text: "My granddaughter visits on Saturday. I'm going to pour the tea myself.", hearts: 6 },
    { id: "l2", who: "tomasz", note: "· new here", text: "First week home. A bit scared, if I'm honest.", hearts: 9 },
    { id: "l3", who: "anne", text: "My first week was the hardest too. It does get lighter, promise.", hearts: 5 },
    { id: "l4", who: "david", text: "Come walking with us, Tomasz. Biscuit loves new people.", hearts: 4 },
  ] as LoungeMessage[],
  script: [
    { kind: "typing", who: "priya" },
    { kind: "message", message: { id: "l5", who: "priya", text: "Morning all! Sun's out in Leicester today.", hearts: 2 } },
    { kind: "arrive", who: "joan", text: "Joan just came in" },
    { kind: "typing", who: "joan" },
    { kind: "message", message: { id: "l6", who: "joan", text: "Kettle's on. Who wants one?", hearts: 4 } },
    { kind: "typing", who: "david" },
    { kind: "message", message: { id: "l7", who: "david", text: "Biscuit says hello to the newcomers.", photo: photos.dog, hearts: 7 } },
    { kind: "arrive", who: "samuel", text: "Samuel just came in" },
    { kind: "typing", who: "anne" },
    { kind: "message", message: { id: "l8", who: "anne", text: "Tomasz, how was your first night home?", hearts: 3 } },
  ] as LoungeEvent[],
  waves: [
    { who: "tomasz", note: "New this week" },
    { who: "margaret", note: "Leeds" },
    { who: "anne", note: "Bath" },
    { who: "priya", note: "Leicester" },
  ] as { who: PersonId; note: string }[],
  poll: {
    question: "What's in your mug right now?",
    options: [
      { id: "tea", label: "Tea", votes: 9, fill: "#F3E3DA" },
      { id: "coffee", label: "Coffee", votes: 5, fill: "#E7DCCB" },
      { id: "cocoa", label: "Hot chocolate", votes: 3, fill: "#E9E2F4" },
    ] as PollOption[],
  },
  quickReplies: [
    { label: "Hello everyone", text: "Hello everyone!", tone: "mint" },
    { label: "Me too", text: "Me too.", tone: "blue" },
    { label: "Well done!", text: "Well done!", tone: "amber" },
    { label: "Thinking of you", text: "Thinking of you.", tone: "lilac" },
  ] as { label: string; text: string; tone: QuickTone }[],
};
export const POLL_OPTION_IDS = lounge.poll.options.map(option => option.id);

export const groupQuickReplies: { label: string; text: string; tone: QuickTone }[] = [
  { label: "Lovely!", text: "Lovely!", tone: "rose" },
  { label: "Well done", text: "Well done!", tone: "amber" },
  { label: "Me too", text: "Me too.", tone: "blue" },
];

/* ---------------------------------------------------------- Sunday circle */

export type CircleSeat = PersonId | "alira" | "you";
export const circle = {
  /** The teacup moves on this often, unless it is with you. */
  everyMs: 3400,
  topic: "What are you looking forward to this week?",
  /** Who speaks next. "you" is skipped until you have taken your seat. */
  order: ["alira", "margaret", "david", "priya", "tomasz", "you", "joan", "anne", "liwei", "samuel"] as CircleSeat[],
  /** Where each one sits: ten places round the circle, clockwise from the top. */
  seats: { alira: 0, david: 1, liwei: 2, tomasz: 3, priya: 4, you: 5, anne: 6, samuel: 7, margaret: 8, joan: 9 } as Record<CircleSeat, number>,
  lines: {
    alira: "Welcome, everyone. Let's go round. What are you looking forward to?",
    margaret: "My granddaughter on Saturday. I am pouring the tea myself.",
    david: "A longer walk with Biscuit. Maybe to the canal.",
    priya: "Choir practice is back on Thursday!",
    tomasz: "Honestly, just sleeping through the night.",
    joan: "My sweet peas should flower any day now.",
    anne: "Seeing my sister. She is driving up from Bath.",
    liwei: "Making dumplings with my grandson.",
    samuel: "Watching the football with my brother.",
  } as Record<Exclude<CircleSeat, "you">, string>,
  /** Lines that send a little warmth floating up when they are said. */
  warmLines: ["margaret", "priya"] as CircleSeat[],
  hello: "Hello everyone. Glad to be here.",
  /** Things to say about your week with one tap. You can also say it in your own words. */
  shareChoices: ["Seeing my family.", "Getting outside for a bit.", "A good night's sleep."],
  upcoming: [
    { id: "hand", name: "Hand and arm circle", when: "Tuesday, 3 pm" },
    { id: "words", name: "Finding words circle", when: "Thursday, 11 am" },
    { id: "sunday", name: "Next Sunday circle", when: "Sunday, 4 pm" },
  ],
};
export const CIRCLE_IDS = circle.upcoming.map(item => item.id);
