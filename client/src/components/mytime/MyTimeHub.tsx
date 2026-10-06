import { ArrowRight } from "lucide-react";
import type { LearnArticle } from "@/content/my-time-learn";
import type { SurvivorStory } from "@/content/my-time-stories";
import { myTimeActivities, type MyTimeActivityId, type MyTimeSection } from "@/lib/my-time";
import ActivityIcon from "./ActivityIcon";
import { turnClass, useMediaQuery, useTurn } from "./hub-motion";
import { articleMinutes } from "./LearnSection";
import MyTimePhoneHub from "./MyTimePhoneHub";
import { ArticleGlyph, StoryInitial } from "./ReadingArt";

export type MyTimeHubProps = {
  suggestion: { id: MyTimeActivityId; line: string };
  /** Today's question and today's story, chosen once per visit: a phone shows these, and so do the doors when motion is reduced. */
  article: LearnArticle;
  story: SurvivorStory;
  /** What the Learn and Stories doors turn through, in order. */
  articles: LearnArticle[];
  stories: SurvivorStory[];
  /** The other questions offered beside today's on a phone. */
  alsoAsked: LearnArticle[];
  onGo: (section: MyTimeSection, item?: string) => void;
};

// The small activities that float round the suggested one: these, in this order, leaving out the one in the middle.
const ORBIT: MyTimeActivityId[] = ["breathing", "pond", "memory_game", "chimes", "lantern", "colour", "postcard", "story", "sounds"];

// The front of My Time: three doors, each showing only its most inviting thing. The activity that
// suits this time of day, a question worth an answer, and a line from someone who has been here.
// The Learn and Stories doors turn slowly through three of theirs. A phone has no room for three
// doors side by side, so it gets the same three as an accordion instead (MyTimePhoneHub); the
// stylesheet shows one or the other, never both.
export default function MyTimeHub(props: MyTimeHubProps) {
  return <>
    <Doors {...props} />
    <MyTimePhoneHub article={props.article} story={props.story} alsoAsked={props.alsoAsked} onGo={props.onGo} />
  </>;
}

function Doors({ suggestion, article, story, articles, stories, onGo }: MyTimeHubProps) {
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  // The doors are hidden on a phone (the accordion stands in for them), so they only turn where they can be seen.
  const wide = useMediaQuery("(min-width: 621px)");
  const activity = myTimeActivities.find(candidate => candidate.id === suggestion.id) ?? myTimeActivities[0];
  const around = ORBIT.filter(id => id !== activity.id).slice(0, 5);
  // With motion reduced, a door keeps still on today's one thing.
  const questions = still ? [article] : articles;
  const voices = still ? [story] : stories;
  const learnTurn = useTurn(questions.length, wide);
  const storyTurn = useTurn(voices.length, wide);
  const question = questions[learnTurn.shown] ?? article;
  const voice = voices[storyTurn.shown] ?? story;

  return <div className="mytime-hub">
    <article className="hub-card hub-play" aria-labelledby="hub-play-kicker">
      <span className="mt-kicker" id="hub-play-kicker">Play and unwind</span>
      <div className="hub-cluster" aria-hidden="true">
        {around.map((id, index) => <span key={id} className={`hub-cluster-${index}`}><ActivityIcon id={id} /></span>)}
        <span className="hub-cluster-main"><ActivityIcon id={activity.id} /></span>
      </div>
      <h2>{suggestion.line}</h2>
      <p className="hub-line">Nine gentle things to do, and each one is here because it can help.</p>
      <div className="hub-actions">
        <button type="button" className="hub-main" onClick={() => onGo("play", activity.id)}>Open {activity.label}<ArrowRight size={16} aria-hidden="true" /></button>
        <button type="button" className="hub-more" onClick={() => onGo("play")}>See all nine</button>
      </div>
    </article>

    <article className="hub-card hub-learn" aria-labelledby="hub-learn-kicker" {...learnTurn.hold}>
      <span className="mt-kicker" id="hub-learn-kicker">Understand your recovery</span>
      <div className="hub-turn" aria-live="off">
        {questions.map((item, index) => <div key={item.id} className={turnClass(learnTurn, index, "hub-turn-item")}>
          <div className={`hub-glyph hub-glyph-${item.id}`} aria-hidden="true"><ArticleGlyph id={item.id} /></div>
          <h2 id={`hub-question-${item.id}`}>{item.question}</h2>
          <p className="hub-line">{item.hook}</p>
        </div>)}
      </div>
      <span className="hub-meta">{articleMinutes(question)} min read · Alira can read it to you</span>
      <div className="hub-actions">
        <button type="button" className="hub-main" onClick={() => onGo("learn", question.id)} aria-describedby={`hub-question-${question.id}`}>Read the answer<ArrowRight size={16} aria-hidden="true" /></button>
        <button type="button" className="hub-more" onClick={() => onGo("learn")}>All questions</button>
      </div>
    </article>

    <article className="hub-card hub-stories" aria-labelledby="hub-stories-kicker" {...storyTurn.hold}>
      <span className="mt-kicker" id="hub-stories-kicker">People who have been here</span>
      <span className="hub-quote-mark" aria-hidden="true">“</span>
      <div className="hub-turn" aria-live="off">
        {voices.map((item, index) => <div key={item.id} className={turnClass(storyTurn, index, "hub-turn-item")}>
          <h2>{item.quote}</h2>
          <p className="story-byline"><StoryInitial name={item.name} voice={item.voice} tint={item.tint} /><span><b id={`hub-voice-${item.id}`}>{item.name}</b>{item.who}</span></p>
        </div>)}
      </div>
      <div className="hub-actions">
        <button type="button" className="hub-main" onClick={() => onGo("stories", voice.id)} aria-describedby={`hub-voice-${voice.id}`}>Read the story<ArrowRight size={16} aria-hidden="true" /></button>
        <button type="button" className="hub-more" onClick={() => onGo("stories")}>All stories</button>
      </div>
    </article>
  </div>;
}
