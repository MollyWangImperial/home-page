import { useSyncExternalStore } from "react";

export const PROFILE_KEY = "rehyn.profile.v1";
export type Profile = { name: string; preferredName: string; email: string; phone: string; city: string; photo: string };
export const DEFAULT_PROFILE: Profile = { name: "Zak", preferredName: "", email: "", phone: "", city: "", photo: "" };
const text = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";

export function readProfile(value: unknown): Profile {
  const raw = value && typeof value === "object" ? value as Partial<Profile> : {};
  const photo = typeof raw.photo === "string" && raw.photo.length <= 250000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.photo) ? raw.photo : "";
  return { name: text(raw.name, 80) || "Zak", preferredName: text(raw.preferredName, 80),
    email: text(raw.email, 254), phone: text(raw.phone, 40), city: text(raw.city, 80), photo };
}

/** A stable snapshot for React, with failed writes leaving the last saved profile intact. */
export function createProfileStore(access: () => Pick<Storage, "getItem" | "setItem"> | null) {
  let cachedRaw: string | null | undefined;
  let cached = DEFAULT_PROFILE;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => { try { listener(); } catch { /* A reader cannot undo a saved profile. */ } });
  return {
    load() {
      try {
        const raw = access()?.getItem(PROFILE_KEY) ?? null;
        if (raw !== cachedRaw) {
          try { cached = raw ? readProfile(JSON.parse(raw)) : DEFAULT_PROFILE; }
          catch { cached = DEFAULT_PROFILE; }
          cachedRaw = raw;
        }
      } catch { /* Keep the last readable snapshot when browser storage is unavailable. */ }
      return cached;
    },
    save(profile: Profile) {
      try {
        const storage = access();
        if (!storage) return false;
        storage.setItem(PROFILE_KEY, JSON.stringify({ v: 1, ...readProfile(profile) }));
        notify(); return true;
      } catch { return false; }
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    notify,
  };
}

export const profileStore = createProfileStore(() => typeof localStorage === "undefined" ? null : localStorage);
function subscribeProfile(listener: () => void) {
  const unsubscribe = profileStore.subscribe(listener);
  const changed = (event: StorageEvent) => { if (event.key === PROFILE_KEY || event.key === null) listener(); };
  window.addEventListener("storage", changed);
  return () => { unsubscribe(); window.removeEventListener("storage", changed); };
}
export const useProfile = () => useSyncExternalStore(subscribeProfile, profileStore.load, () => DEFAULT_PROFILE);
export const profileName = (profile: Profile) => profile.preferredName || profile.name;
export const profileInitial = (profile: Profile) => profileName(profile).slice(0, 1).toUpperCase();

/** Resize and strip metadata on-device. Profile photos are never uploaded to a service. */
export async function prepareProfilePhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP photo.");
  if (file.size > 6 * 1024 * 1024) throw new Error("Choose a photo smaller than 6 MB.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("This photo couldn’t be opened. Try another JPG, PNG or WebP image."); }
  try {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx || !bitmap.width || !bitmap.height) throw new Error("This photo couldn’t be opened. Try another image.");
    const edge = Math.min(bitmap.width, bitmap.height);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, 256, 256);
    const photo = canvas.toDataURL("image/jpeg", .85);
    if (!readProfile({ photo }).photo) throw new Error("This photo couldn’t be saved. Try another image.");
    return photo;
  } finally { bitmap.close(); }
}
