export const ACCOUNT_RESET_BACKUP_KEY = "rehyn.account.reset-backup.v1";
type AccountStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Stores = { local: AccountStorage; session: AccountStorage };
type Entries = [string, string][];
type Snapshot = { v: 1; local: Entries; session: Entries };

const isAccountKey = (key: string) => key.startsWith("rehyn.") && key !== ACCOUNT_RESET_BACKUP_KEY;

function entries(store: AccountStorage): Entries {
  const saved: Entries = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !isAccountKey(key)) continue;
    const value = store.getItem(key);
    if (value !== null) saved.push([key, value]);
  }
  return saved;
}

function readBackup(raw: string | null): Snapshot | null {
  try {
    const saved = JSON.parse(raw ?? "null");
    const validEntries = (value: unknown): value is Entries => Array.isArray(value) && value.every(pair =>
      Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" && isAccountKey(pair[0]) && typeof pair[1] === "string");
    return saved?.v === 1 && validEntries(saved.local) && validEntries(saved.session) ? saved : null;
  } catch { return null; }
}

function replaceAccount(stores: Stores, saved: Snapshot) {
  for (const name of ["local", "session"] as const) {
    const store = stores[name];
    // Collect before removing: Storage's indexes change as entries are removed.
    for (const [key] of entries(store)) store.removeItem(key);
    for (const [key, value] of saved[name]) store.setItem(key, value);
  }
}

/** Local demo account only. Keep one restorable account while testing fresh onboarding. */
export function createAccountResetStore(access: () => Stores) {
  function change(undo: boolean): boolean {
    let stores: Stores | undefined;
    let before: Snapshot | undefined;
    let oldBackup: string | null = null;
    let started = false;
    try {
      stores = access();
      oldBackup = stores.local.getItem(ACCOUNT_RESET_BACKUP_KEY);
      const backup = readBackup(oldBackup);
      if (undo && !backup) return false;
      before = { v: 1, local: entries(stores.local), session: entries(stores.session) };
      if (!undo && !backup) {
        // Save first. If storage is full, leave the current account intact.
        stores.local.setItem(ACCOUNT_RESET_BACKUP_KEY, JSON.stringify(before));
      }
      started = true;
      replaceAccount(stores, undo ? backup! : { v: 1, local: [], session: [] });
      if (undo) stores.local.removeItem(ACCOUNT_RESET_BACKUP_KEY);
      return true;
    } catch {
      if (started && stores && before) {
        try {
          replaceAccount(stores, before);
          if (oldBackup === null) stores.local.removeItem(ACCOUNT_RESET_BACKUP_KEY);
          else stores.local.setItem(ACCOUNT_RESET_BACKUP_KEY, oldBackup);
        } catch { /* Keep the backup available if storage also rejects rollback. */ }
      }
      return false;
    }
  }
  return {
    canUndo: () => {
      try { return readBackup(access().local.getItem(ACCOUNT_RESET_BACKUP_KEY)) !== null; }
      catch { return false; }
    },
    reset: () => change(false),
    undo: () => change(true),
  };
}

export const accountResetStore = createAccountResetStore(() => ({ local: localStorage, session: sessionStorage }));
