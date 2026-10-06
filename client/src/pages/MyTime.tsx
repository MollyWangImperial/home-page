import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import RecoveryShell from "@/components/RecoveryShell";
import LearnSection from "@/components/mytime/LearnSection";
import MyTimeHub from "@/components/mytime/MyTimeHub";
import PlaySection from "@/components/mytime/PlaySection";
import StoriesSection from "@/components/mytime/StoriesSection";
import { learnArticles } from "@/content/my-time-learn";
import { survivorStories } from "@/content/my-time-stories";
import { alsoAsked, dayNumber, doorTurn, featured, HUB_LEARN_TURN, HUB_STORY_TURN, myTimeHref, myTimeStore, myTimeViewFromQuery, suggestedActivity, type MyTimeSection } from "@/lib/my-time";
import { todayLabel } from "./Welcome";
import "./mytime-refinements.css";
import "./mytime-stage.css";
import "./mytime-sections.css";
// Loaded after the shared section styles so each section's own design wins.
import "./mytime-learn.css";
import "./mytime-stories.css";
import "@/components/mytime/my-time-activities.css";

const tabs: [MyTimeSection | null, string][] = [[null, "Overview"], ["play", "Play"], ["learn", "Learn"], ["stories", "Stories"]];
const opened = (read: string[], section: "learn" | "stories") => read.filter(key => key.startsWith(`${section}:`)).map(key => key.slice(section.length + 1));

// My Time has three sections: things to do, short answers about stroke, and stories from survivors
// and carers. The front page shows one inviting thing from each; choosing it opens that section.
// The address says where you are, so the browser's back button works and other pages can link in:
//   /my-time                                  the front page
//   /my-time?section=play&activity=pond       one activity  (older links: /my-time?activity=breathing&minutes=3)
//   /my-time?section=learn&read=fatigue       one article
//   /my-time?section=stories&story=david      one story
export default function MyTime() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const view = myTimeViewFromQuery(search);
  const [minutes] = useState(() => {
    const asked = Number(new URLSearchParams(search).get("minutes"));
    return [1, 3, 5].includes(asked) ? asked : undefined;
  });
  const [today] = useState(() => new Date());
  const [suggestion] = useState(() => suggestedActivity(today));
  const [read, setRead] = useState(() => myTimeStore.load().read);
  // What the front page shows off is chosen once per visit, so it does not change under the reader:
  // today's question and story, the other questions offered beside it, and the order the doors turn in.
  const [hub] = useState(() => {
    const learnt = opened(read, "learn");
    const article = featured(learnArticles, learnt, dayNumber(today));
    const story = featured(survivorStories, opened(read, "stories"), dayNumber(today));
    return {
      article,
      story,
      alsoAsked: alsoAsked(learnArticles, article.id, learnt),
      articles: doorTurn(learnArticles, HUB_LEARN_TURN, article.id),
      stories: doorTurn(survivorStories, HUB_STORY_TURN, story.id),
    };
  });
  // The activities stay as they were left once they have been opened in this visit.
  const [playOpened, setPlayOpened] = useState(view.section === "play");
  const top = useRef<HTMLDivElement>(null);
  const firstView = useRef(true);

  useEffect(() => { if (view.section === "play") setPlayOpened(true); }, [view.section]);
  useEffect(() => {
    const known = view.section === "learn" ? learnArticles : view.section === "stories" ? survivorStories : [];
    if ((view.section === "learn" || view.section === "stories") && known.some(item => item.id === view.item)) setRead(myTimeStore.markRead(view.section, view.item!));
  }, [view.section, view.item]);
  // Each new view starts at its top. (The first one is left alone: a link to an activity scrolls to it.)
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    top.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [view.section, view.item]);

  const go = (section?: MyTimeSection | null, item?: string | null) => setLocation(myTimeHref(section, item));

  return (
    <RecoveryShell active="My Time" dateLabel={todayLabel()}>
      <div ref={top} className={`recovery-page mytime-page mytime-view-${view.section ?? "hub"}`}>
        <section className="recovery-page-heading mytime-heading">
          <div>
            <h1>My Time<span>.</span></h1>
            {/* Shown on a phone only, where the front page is an accordion and the section tabs give way to this. */}
            {!view.section && <p className="mytime-hub-intro">Three ways to spend a little time. Tap one to open it.</p>}
          </div>
          <div className="journey-tabs mytime-tabs" role="tablist" aria-label="My Time sections">
            {tabs.map(([section, label]) => <button key={label} type="button" role="tab" aria-selected={view.section === section} className={view.section === section ? "is-active" : ""} onClick={() => go(section)}>{label}</button>)}
          </div>
        </section>
        {!view.section && <MyTimeHub suggestion={suggestion} {...hub} onGo={go} />}
        {playOpened && <div hidden={view.section !== "play"}><PlaySection shown={view.section === "play"} requested={view.activity} suggested={suggestion.id} minutes={minutes} /></div>}
        {view.section === "learn" && <LearnSection shown itemId={view.item} read={read} onOpen={id => go("learn", id)} />}
        {view.section === "stories" && <StoriesSection shown itemId={view.item} read={read} onOpen={id => go("stories", id)} />}
      </div>
    </RecoveryShell>
  );
}
