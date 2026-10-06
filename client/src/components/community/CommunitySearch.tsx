import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { people, type PersonId, type SampleGroup, type SuggestedGroupId } from "@/content/community-samples";
import { communityHref, communityStore, friendsHref, leadsHere, relationship, useCommunity, type CommunityPlace, type Relationship } from "@/lib/community-store";
import { friendChangeNote, highlight, type FindResults, type Place, type PlaceId } from "./alerts-helpers";
import { BlockIcon, ChatIcon, CheckIcon, ClockIcon, CupIcon, HandIcon, HeartIcon, NextIcon, PlusIcon, RingIcon, ShieldIcon, SlidersIcon, UsersIcon } from "./icons";
import { Cover, Face, FriendButton } from "./parts";

// What Find shows under its search box (FindPanel.tsx). Before anything is typed: the places in
// My community, one tap each, so nobody has to type to get somewhere. Then the people, groups
// and places whose names match, best first, with the matching letters marked. Links close the
// panel as they go; Add friend and Join work in place. Everything found is on this page already.

const placeLook: Record<PlaceId, { tone: string; icon: ReactNode }> = {
  feed: { tone: "amber", icon: <HeartIcon size={20} /> },
  lounge: { tone: "rose", icon: <CupIcon size={20} /> },
  circle: { tone: "circle", icon: <RingIcon size={20} /> },
  groups: { tone: "mint", icon: <ChatIcon size={20} /> },
  start: { tone: "start", icon: <PlusIcon size={20} /> },
  friends: { tone: "blue", icon: <UsersIcon size={20} /> },
  "friends-sent": { tone: "blue", icon: <ClockIcon size={20} /> },
  "friends-list": { tone: "blue", icon: <HandIcon size={20} /> },
  "friends-blocked": { tone: "amber", icon: <BlockIcon size={20} /> },
  safety: { tone: "rose", icon: <ShieldIcon size={20} /> },
  settings: { tone: "lilac", icon: <SlidersIcon size={20} /> },
};

/** A name with the letters that match what was typed marked. */
function Marked({ text, query }: { text: string; query: string }) {
  return <>{highlight(text, query).map((piece, index) => (piece.hit ? <mark key={index} className="cm-al-find-mark">{piece.text}</mark> : <Fragment key={index}>{piece.text}</Fragment>))}</>;
}

function Section({ title, tone = "green", children }: { title: string; tone?: "green" | "rust"; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="cm-al-find-section" aria-labelledby={headingId}>
      <h3 id={headingId} className={`cm-overline ${tone === "rust" ? "cm-overline-rust" : ""}`}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Places as tiles, each a link. The one the person is on says so, and only closes Find: it keeps
 * the view as it is (the same group open), without adding it to Back again.
 */
function PlaceTiles({ places, query, here, onClose }: { places: Place[]; query: string; here: CommunityPlace; onClose: () => void }) {
  const search = useSearch();
  return (
    <ul className="cm-al-find-places">
      {places.map(place => {
        const current = place.space === here.space;
        const href = current ? communityHref(here.space, here.group) : place.href;
        const look = placeLook[place.id];
        return (
          <li key={place.id}>
            <Link
              className={`cm-al-find-place ${current ? "is-here" : ""}`}
              href={href}
              replace={leadsHere(href, search)}
              onClick={onClose}
              aria-current={current ? "page" : undefined}
              aria-label={`${place.label}, ${current ? "you're here" : place.note}`}
            >
              <span className={`cm-al-find-icon is-${look.tone}`} aria-hidden="true">{look.icon}</span>
              <span className="cm-al-find-place-text"><b><Marked text={place.label} query={query} /></b><span>{current ? "You're here" : place.note}</span></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export type CommunitySearchProps = {
  /** What `findInCommunity` found for the words in the search box. */
  results: FindResults;
  /** The view the person is on: the Friends links open the drawer over it. */
  over: CommunityPlace;
  /** Closes the Find panel. Every result that is a link calls it. */
  onClose: () => void;
};

/** The results of a search in My community, in sections: people, groups and places. */
export default function CommunitySearch({ results, over, onClose }: CommunitySearchProps) {
  const memory = useCommunity();
  const search = useSearch();
  const box = useRef<HTMLDivElement>(null);
  /** The row last pressed in ("person:joan", "group:knit"), so the focus can follow it. */
  const pressed = useRef<string | null>(null);
  /** Someone whose friend button was just pressed, and where they stood with the person before. */
  const watching = useRef<{ who: PersonId; was: Relationship } | null>(null);
  const [note, setNote] = useState("");
  const { query } = results;
  const searching = results.words.length > 0;

  // Join, or a friend button that turns into a link, takes away the button that was pressed. The
  // focus then goes to the same row in its new place (a joined group moves to "Your groups"), so
  // a keyboard or screen reader carries on from there instead of starting again at the top.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!pressed.current || (active && active !== document.body)) return;
    const row = box.current?.querySelector(`[data-cm-row="${pressed.current}"]`);
    const target = row?.querySelector<HTMLElement>("a[href], button:not([disabled])") ?? box.current?.closest("[role='dialog']")?.querySelector<HTMLElement>("[data-autofocus]");
    target?.focus();
  });

  // Says what a friend button did, for anyone who can't see it change.
  useEffect(() => {
    const watch = watching.current;
    if (!watch) return;
    const now = relationship(memory, watch.who);
    if (now === watch.was) return;
    watching.current = null;
    setNote(friendChangeNote(watch.who, watch.was, now));
  }, [memory]);

  const pressPerson = (who: PersonId, was: Relationship) => (event: MouseEvent<HTMLLIElement>) => {
    if (!(event.target instanceof Element) || !event.target.closest("button, a")) return;
    pressed.current = `person:${who}`;
    watching.current = { who, was };
  };
  const join = (group: SampleGroup) => {
    pressed.current = `group:${group.id}`;
    communityStore.toggleJoined(group.id as SuggestedGroupId);
    setNote(`You joined ${group.name}. It's in your groups now.`);
  };

  return (
    <div ref={box} className="cm-al-find-results">
      {searching && results.total === 0 && (
        <div className="cm-al-find-empty">
          <p className="cm-al-find-empty-title">{`Nothing found for “${query.trim()}”`}</p>
          <p>Try a first name, like Margaret, or a group, like Garden gang. Or pick a place below.</p>
        </div>
      )}

      {results.people.length > 0 && (
        <Section title="People">
          <ul className="cm-al-find-list">
            {results.people.map(({ who, status, muted }) => {
              const person = people[who];
              return (
                <li key={who} className="cm-al-find-row" data-cm-row={`person:${who}`} onClickCapture={pressPerson(who, status)}>
                  <Face who={who} size={44} />
                  <span className="cm-al-find-text">
                    <b><Marked text={person.name} query={query} /></b>
                    <span>{muted ? `${person.about} · posts hidden for you` : person.about}</span>
                  </span>
                  {status === "friend" ? (
                    <Link className="cm-friend is-friend cm-al-find-friend" href={friendsHref("friends", over)} onClick={onClose}>
                      <CheckIcon size={15} />Friends<span className="cm-sr">{` with ${person.name}. Open your friends list`}</span>
                    </Link>
                  ) : <FriendButton who={who} onLeave={onClose} />}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {results.groups.length > 0 && (
        <Section title="Your groups">
          <ul className="cm-al-find-list">
            {results.groups.map(({ group, sub }) => (
              <li key={group.id} data-cm-row={`group:${group.id}`}>
                <Link
                  className="cm-al-find-link"
                  href={communityHref("groups", group.id)}
                  replace={leadsHere(communityHref("groups", group.id), search)}
                  onClick={onClose}
                  aria-label={`${group.name}, ${sub}${group.unread > 0 ? `, ${group.unread} unread` : ""}`}
                >
                  <Cover cover={group.cover} className="cm-al-find-cover" />
                  <span className="cm-al-find-text"><b><Marked text={group.name} query={query} /></b><span>{sub}</span></span>
                  {group.unread > 0 && <span className="cm-badge" aria-hidden="true">{group.unread}</span>}
                  <NextIcon size={18} className="cm-al-find-go" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {results.suggested.length > 0 && (
        <Section title="Groups you might like" tone="rust">
          <ul className="cm-al-find-list">
            {results.suggested.map(group => (
              <li key={group.id} className="cm-al-find-row" data-cm-row={`group:${group.id}`}>
                <Cover cover={group.cover} className="cm-al-find-cover" />
                <span className="cm-al-find-text"><b><Marked text={group.name} query={query} /></b><span>{group.why}</span></span>
                <button type="button" className="cm-join" onClick={() => join(group)}>Join<span className="cm-sr">{` ${group.name}`}</span></button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {searching && results.places.length > 0 && (
        <Section title="Places"><PlaceTiles places={results.places} query={query} here={over} onClose={onClose} /></Section>
      )}
      {(!searching || results.total === 0) && (
        <Section title="Places"><PlaceTiles places={results.browse} query="" here={over} onClose={onClose} /></Section>
      )}

      <p className="cm-sr" role="status">{note}</p>
    </div>
  );
}
