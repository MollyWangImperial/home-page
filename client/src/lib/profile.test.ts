import { afterEach, describe, expect, it, vi } from "vitest";
import { createProfileStore, DEFAULT_PROFILE, prepareProfilePhoto, PROFILE_KEY, readProfile } from "./profile";

afterEach(() => { vi.unstubAllGlobals(); });

describe("local profile persistence", () => {
  it("saves editable details, keeps snapshots stable and reloads after navigation", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = createProfileStore(() => storage); const notify = vi.fn(); store.subscribe(notify);
    expect(store.load()).toBe(DEFAULT_PROFILE);
    expect(store.save({ ...DEFAULT_PROFILE, name: " Zak ", preferredName: " Z ", email: "zak@example.test", phone: "07000 000000", city: "London", photo: "data:image/jpeg;base64,YQ==" })).toBe(true);
    expect(notify).toHaveBeenCalledOnce();
    const snapshot = store.load(); expect(store.load()).toBe(snapshot);
    expect(createProfileStore(() => storage).load()).toEqual({ name: "Zak", preferredName: "Z", email: "zak@example.test", phone: "07000 000000", city: "London", photo: "data:image/jpeg;base64,YQ==" });
    values.delete(PROFILE_KEY); expect(store.load()).toBe(DEFAULT_PROFILE);
  });

  it("recovers from malformed storage and rejects remote, SVG and oversized photo values", () => {
    expect(createProfileStore(() => ({ getItem: () => "{broken", setItem: () => {} })).load()).toBe(DEFAULT_PROFILE);
    for (const photo of ["https://example.com/avatar.png", "data:image/svg+xml;base64,YQ==", `data:image/jpeg;base64,${"a".repeat(250000)}`]) expect(readProfile({ photo }).photo).toBe("");
    const clean = readProfile({ name: "x".repeat(100), phone: "y".repeat(100), extra: "ignored" });
    expect(clean.name).toHaveLength(80); expect(clean.phone).toHaveLength(40); expect(clean).not.toHaveProperty("extra");
  });

  it("reports storage failures without discarding the last saved profile", () => {
    const store = createProfileStore(() => ({ getItem: () => JSON.stringify({ name: "Existing" }), setItem: () => { throw new Error("quota"); } }));
    expect(store.load().name).toBe("Existing");
    expect(store.save({ ...DEFAULT_PROFILE, name: "New" })).toBe(false);
    expect(store.load().name).toBe("Existing");
    expect(createProfileStore(() => null).save(DEFAULT_PROFILE)).toBe(false);
  });
});

describe("profile photo preparation", () => {
  it("rejects unsupported or oversized files before decoding them", async () => {
    const decode = vi.fn(); vi.stubGlobal("createImageBitmap", decode);
    await expect(prepareProfilePhoto({ type: "image/svg+xml", size: 100 } as File)).rejects.toThrow("JPG, PNG or WebP");
    await expect(prepareProfilePhoto({ type: "image/jpeg", size: 7 * 1024 * 1024 } as File)).rejects.toThrow("6 MB");
    expect(decode).not.toHaveBeenCalled();
  });

  it("crops and resizes locally, strips metadata and releases decoded image memory", async () => {
    const bitmap = { width: 1200, height: 800, close: vi.fn() };
    const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn(() => "data:image/jpeg;base64,YQ==") };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.stubGlobal("document", { createElement: () => canvas });
    expect(await prepareProfilePhoto({ type: "image/jpeg", size: 100 } as File)).toBe("data:image/jpeg;base64,YQ==");
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 200, 0, 800, 800, 0, 0, 256, 256);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", .85);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("shows a recoverable error for a corrupt image", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode")));
    await expect(prepareProfilePhoto({ type: "image/png", size: 100 } as File)).rejects.toThrow("couldn’t be opened");
  });
});
