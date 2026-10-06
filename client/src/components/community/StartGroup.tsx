import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { defaultInvites, GROUP_NAME_LIMIT, groupHellos, groupThemes, inviteFriends, people, type PersonId, type ThemeId } from "@/content/community-samples";
import { communityHref, communityStore, isBlocked, listNames, useCommunity, type CommunityMemory, type StartedGroup } from "@/lib/community-store";
import { coverForTheme } from "./group-model";
import { ArrowIcon, CheckIcon, ShieldIcon, ThemeIcon, UsersIcon } from "./icons";
import { AliraMark, Cover, Face, MyFace, OnlyYou } from "./parts";

const helloLabels = ["Hello everyone!", "Welcome to the group", "Who's got news?"];
const helloTones = ["cm-quick-mint", "cm-quick-amber", "cm-quick-blue"];
const nameOf = (who: PersonId) => people[who].name;
/** Blocked people are out of sight in My community, so they are never offered, ticked or shown here. */
const unblocked = (memory: CommunityMemory, list: PersonId[]) => list.filter(who => !isBlocked(memory, who));

/** I: start your own group in three taps: what it's about, a name, and who's coming. */
export default function StartGroupView({ name }: { name: string }) {
  const memory = useCommunity();
  const [theme, setTheme] = useState<ThemeId>(groupThemes[0].id);
  const [groupName, setGroupName] = useState(groupThemes[0].names[0]);
  const [chosen, setChosen] = useState<PersonId[]>(defaultInvites);
  const pickable = unblocked(memory, inviteFriends);
  // Someone blocked since they were ticked drops out of the group too.
  const friends = unblocked(memory, chosen);
  const [open, setOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const createdHeading = useRef<HTMLHeadingElement>(null);
  const firstChoice = useRef<HTMLInputElement>(null);
  const themeField = useId();
  const nameId = useId();
  const privacyField = useId();

  const look = groupThemes.find(item => item.id === theme) ?? groupThemes[0];
  const shownName = groupName.trim() === "" ? "Your group" : groupName.trim();
  const created: StartedGroup | null = createdId ? memory.started.find(group => group.id === createdId) ?? null : null;
  const count = friends.length;
  const memberLine = count === 0 ? "Just you for now" : count === 1 ? "You and 1 friend" : `You and ${count} friends`;

  useEffect(() => { if (createdId && !created) setCreatedId(null); }, [createdId, created]);

  const pickTheme = (next: ThemeId) => {
    // A name typed by hand is kept. One of the old theme's suggestions follows the new theme.
    if (groupName.trim() === "" || look.names.includes(groupName)) setGroupName(groupThemes.find(item => item.id === next)?.names[0] ?? groupName);
    setTheme(next);
  };
  const toggleFriend = (who: PersonId) => setChosen(list => (list.includes(who) ? list.filter(other => other !== who) : inviteFriends.filter(other => other === who || list.includes(other))));
  const start = (event: FormEvent) => {
    event.preventDefault();
    const group = communityStore.startGroup({ name: shownName, theme, friends, open });
    setCreatedId(group.id);
    window.requestAnimationFrame(() => createdHeading.current?.focus());
  };
  const startAnother = () => {
    setCreatedId(null);
    setTheme(groupThemes[0].id);
    setGroupName(groupThemes[0].names[0]);
    setChosen(defaultInvites);
    setOpen(false);
    window.requestAnimationFrame(() => firstChoice.current?.focus());
  };

  const coming = created ? unblocked(memory, created.friends) : friends;
  const going = coming.map(nameOf);
  const inviteLine = going.length === 0
    ? "It's just you for now. Your group is kept on this device, and you can invite friends whenever you like."
    : `${listNames(going)} ${going.length === 1 ? "is an example friend" : "are example friends"}, so no invitations go out in this preview. Your group is kept on this device.`;

  return (
    <div className="cm-start">
      <div className="cm-start-main">
        {!created ? (
          <form className="cm-card cm-start-form cm-rise" onSubmit={start}>
            <fieldset className="cm-step">
              <legend className="cm-step-title"><span className="cm-step-num cm-step-1" aria-hidden="true">1</span><span>What's it about?</span></legend>
              <div className="cm-themes">
                {groupThemes.map((item, index) => (
                  <label key={item.id} className={`cm-theme ${theme === item.id ? "is-on" : ""}`} style={{ background: item.tint, color: item.ink }}>
                    <input ref={index === 0 ? firstChoice : undefined} className="cm-sr" type="radio" name={themeField} value={item.id} checked={theme === item.id} onChange={() => pickTheme(item.id)} />
                    <ThemeIcon theme={item.id} size={26} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="cm-step">
              <div className="cm-step-title"><span className="cm-step-num cm-step-2" aria-hidden="true">2</span><label htmlFor={nameId}>Give it a name</label></div>
              <input id={nameId} className="cm-name-input" type="text" value={groupName} maxLength={GROUP_NAME_LIMIT} autoComplete="off" onChange={event => setGroupName(event.target.value)} />
              <div className="cm-name-ideas" role="group" aria-label="Name ideas">
                <span>Or try:</span>
                {look.names.map(idea => (
                  <button key={idea} type="button" className={`cm-name-idea ${groupName === idea ? "is-on" : ""}`} aria-pressed={groupName === idea} onClick={() => setGroupName(idea)}>{idea}</button>
                ))}
              </div>
            </div>

            <fieldset className="cm-step">
              <legend className="cm-step-title"><span className="cm-step-num cm-step-3" aria-hidden="true">3</span><span>Who's coming?</span><span className="cm-step-aside">Tap your friends</span></legend>
              <div className="cm-friend-picks">
                {pickable.map(who => {
                  const on = friends.includes(who);
                  return (
                    <label key={who} className={`cm-friend-pick ${on ? "is-on" : ""}`}>
                      <input className="cm-sr" type="checkbox" checked={on} onChange={() => toggleFriend(who)} />
                      <span className="cm-friend-face"><Face who={who} size={54} /><span className="cm-friend-check" aria-hidden="true"><CheckIcon size={12} /></span></span>
                      <span>{nameOf(who)}</span>
                    </label>
                  );
                })}
              </div>
              <div className="cm-privacy">
                <label className={!open ? "is-on" : ""}><input className="cm-sr" type="radio" name={privacyField} checked={!open} onChange={() => setOpen(false)} />Only friends I invite</label>
                <label className={open ? "is-on" : ""}><input className="cm-sr" type="radio" name={privacyField} checked={open} onChange={() => setOpen(true)} />Anyone can ask to join</label>
              </div>
            </fieldset>

            <button type="submit" className="cm-start-button">Start the group <ArrowIcon size={22} strokeWidth={2} /></button>
          </form>
        ) : (
          <section className="cm-card cm-created cm-pop" aria-labelledby="cm-created-title">
            <span className="cm-confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
            <span className="cm-created-icon" aria-hidden="true"><UsersIcon size={44} /></span>
            <h2 id="cm-created-title" ref={createdHeading} tabIndex={-1}><span>{created.name}</span> is open!</h2>
            <p className="cm-created-line">{inviteLine}</p>
            <p className="cm-created-hello-title">Say the first hello</p>
            <div className="cm-hello-choices">
              {groupHellos.map((hello, index) => (
                <button key={hello} type="button" className={`cm-quick cm-quick-large ${helloTones[index]}`} aria-pressed={created.hello === hello} onClick={() => communityStore.setGroupHello(created.id, hello)}>{helloLabels[index]}</button>
              ))}
            </div>
            {created.hello && (
              <div key={created.hello} className="cm-hello-sent cm-pop">
                <p className="cm-hello-bubble">{created.hello}</p>
                <OnlyYou />
              </div>
            )}
            <div className="cm-created-actions">
              <Link className="cm-btn cm-btn-rust cm-btn-large" href={communityHref("groups", created.id)}>Go to the group <ArrowIcon size={20} strokeWidth={2} /></Link>
              <button type="button" className="cm-btn cm-btn-outline cm-btn-large" onClick={startAnother}>Start another</button>
            </div>
          </section>
        )}
      </div>

      <aside className="cm-start-side" aria-labelledby="cm-preview-title">
        <h2 className="cm-preview-title" id="cm-preview-title">Here's how it will look</h2>
        <div className="cm-preview-card cm-rise-2">
          <Cover cover={coverForTheme(created?.theme ?? theme)} className="cm-preview-cover" iconSize={60} />
          <div className="cm-preview-body">
            <div>
              <p className="cm-preview-name">{created?.name ?? shownName}</p>
              <p className="cm-preview-meta">Started by you · {(created?.open ?? open) ? "anyone can ask to join" : "invite only"}</p>
            </div>
            <div className="cm-preview-members">
              <span className="cm-face-stack" aria-hidden="true">
                <MyFace size={38} />
                {coming.map(who => <Face key={who} who={who} size={38} className="cm-pop" />)}
              </span>
              <span>{created ? (coming.length === 0 ? "Just you for now" : coming.length === 1 ? "You and 1 friend" : `You and ${coming.length} friends`) : memberLine}</span>
            </div>
            <div className="cm-preview-alira">
              <AliraMark size={32} />
              <p>{`Lovely idea, ${name}. I'll be here to welcome everyone in.`}</p>
            </div>
          </div>
        </div>
        <p className="cm-preview-safe"><ShieldIcon size={20} /><span>You can add or remove people, or close the group, any time. Alira keeps every group kind.</span></p>
      </aside>
    </div>
  );
}
