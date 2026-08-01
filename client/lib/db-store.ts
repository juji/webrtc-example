import { PrimssgDBLockedError, PrimssgDBWasm } from "primssg-db";
import { create } from "zustand";

type DbState = {
  db: PrimssgDBWasm;
  connected: boolean;
  locked: boolean;
  connect: () => Promise<void>;
};

// One PrimssgDBWasm instance for the whole app — keys.ts/contacts.ts/chats.ts all
// read db from here rather than each opening their own connection. Only one real
// SQLite/SAHPool connection can exist at a time (plans/sqlite-migration Phase 0's
// Context), so this is not just convenience, it's the only valid shape.
export const useDbStore = create<DbState>()((set, get) => ({
  db: new PrimssgDBWasm(),
  connected: false,
  locked: false,

  connect: async () => {
    if (get().connected) return;
    try {
      await get().db.connect();
      set({ connected: true });
    } catch (err) {
      if (err instanceof PrimssgDBLockedError) set({ locked: true });
      else throw err;
    }
  },
}));
