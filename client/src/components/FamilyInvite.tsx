import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import AliraAvatar from "./AliraAvatar";
import { inviteCopy, recordInvite, type InviteMoment } from "@/lib/family-invite";
import "./family-invite.css";

/**
 * Alira's invitation to share progress with family, shown on the Journey at moments worth sharing.
 * The choice is always easy to make either way: share, not now, or never ask again.
 */
export function FamilyInvite({ moment, day, name, onShare }: { moment: InviteMoment; day: string; name: string; onShare: () => void }) {
  const [closed, setClosed] = useState<null | "later" | "never">(null);
  const [acknowledgementDone, setAcknowledgementDone] = useState(false);
  const copy = inviteCopy(moment, name);

  useEffect(() => {
    if (!closed) return;
    // Match the five-second reading time and 1.2-second fade/collapse in the stylesheet.
    const timer = window.setTimeout(() => setAcknowledgementDone(true), 6200);
    return () => window.clearTimeout(timer);
  }, [closed]);

  if (closed) {
    if (acknowledgementDone) return null;
    return (
      <div className="fi-ack-shell">
        <div className="fi-ack-clip">
          <p className="fi-ack" role="status">
            <Check size={15} aria-hidden="true" />
            {closed === "never"
              ? "Of course. I won't ask again. You can still turn on sharing any time in Share with family."
              : "Of course. You can turn on sharing any time in Share with family."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="fi" aria-labelledby="fi-title">
      <span className="fi-avatar" aria-hidden="true"><AliraAvatar /></span>
      <div className="fi-body">
        <h2 id="fi-title">{copy.title}</h2>
        <p>{copy.message}</p>
        <div className="fi-actions">
          <button type="button" className="fi-primary" onClick={() => { recordInvite(moment, day, "share"); onShare(); }}>{copy.share}</button>
          <button type="button" className="fi-secondary" onClick={() => { recordInvite(moment, day, "later"); setClosed("later"); }}>Not now</button>
        </div>
        <button type="button" className="fi-never" onClick={() => { recordInvite(moment, day, "never"); setClosed("never"); }}>Please don't ask me again</button>
      </div>
    </section>
  );
}
