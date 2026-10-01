import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { prepareProfilePhoto, profileInitial, profileName, profileStore, useProfile, type Profile } from "@/lib/profile";

export function ProfileInformation() {
  const saved = useProfile();
  const [draft, setDraft] = useState(saved);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const photoRequest = useRef(0);
  useEffect(() => () => { photoRequest.current += 1; }, []);
  const change = (key: keyof Profile, value: string) => {
    setDraft(current => ({ ...current, [key]: value })); setNotice(""); setError("");
  };
  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    const request = ++photoRequest.current;
    setProcessing(true); setError(""); setNotice("");
    try {
      const photo = await prepareProfilePhoto(file);
      if (request === photoRequest.current) setDraft(current => ({ ...current, photo }));
    } catch (failure) {
      if (request === photoRequest.current) setError(failure instanceof Error ? failure.message : "This photo couldn’t be opened.");
    } finally { if (request === photoRequest.current) setProcessing(false); }
  }
  return (
    <form className="settings-profile-content" onSubmit={event => {
      event.preventDefault();
      if (processing) return;
      if (!draft.name.trim()) { setError("Please enter a name."); setNotice(""); return; }
      if (profileStore.save(draft)) { setDraft(profileStore.load()); setNotice("Profile saved."); setError(""); }
      else { setError("Your profile couldn’t be saved in this browser. Your changes are still here to try again."); setNotice(""); }
    }}>
      <div className="settings-profile-identity">
        <button type="button" className="settings-profile-photo-button" onClick={() => input.current?.click()} aria-label={draft.photo ? "Change profile photo" : "Add profile photo"} disabled={processing}>
          <span className="settings-profile-avatar">{draft.photo ? <img src={draft.photo} alt="" /> : profileInitial(draft)}</span>
          <span className="settings-profile-camera"><Camera size={14} aria-hidden="true" /></span>
        </button>
        <div>
          <h3>{profileName(draft)}</h3>
          <div className="settings-profile-photo-actions">
            <button type="button" onClick={() => input.current?.click()} disabled={processing}>{processing ? "Preparing photo…" : draft.photo ? "Change photo" : "Add photo"}</button>
            {draft.photo && <button type="button" onClick={() => change("photo", "")} disabled={processing}>Remove photo</button>}
          </div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile photo" hidden onChange={event => { void choosePhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        </div>
      </div>
      <section className="settings-profile-card" aria-labelledby="settings-details-title">
        <h3 id="settings-details-title">Personal information</h3>
        <div className="settings-profile-fields">
          <label>Name<input autoComplete="name" value={draft.name} maxLength={80} required onChange={event => change("name", event.target.value)} /></label>
          <label>Preferred name <span>(optional)</span><input autoComplete="nickname" value={draft.preferredName} maxLength={80} onChange={event => change("preferredName", event.target.value)} /></label>
          <label>Email address <span>(optional)</span><input type="email" autoComplete="email" value={draft.email} maxLength={254} onChange={event => change("email", event.target.value)} /></label>
          <label>Phone number <span>(optional)</span><input type="tel" autoComplete="tel" value={draft.phone} maxLength={40} onChange={event => change("phone", event.target.value)} /></label>
          <label>Town / city <span>(optional)</span><input autoComplete="address-level2" value={draft.city} maxLength={80} onChange={event => change("city", event.target.value)} /></label>
        </div>
      </section>
      <div className="settings-profile-save">
        <button type="submit" disabled={processing}>Save changes</button>
      </div>
      <p className="settings-profile-feedback" role={error ? "alert" : "status"}>{error || notice}</p>
    </form>
  );
}
