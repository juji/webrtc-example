import { del, get, set as idbSet } from "idb-keyval";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { User } from "./api";

type SessionState = {
  user: User | null;
  hasHydrated: boolean;
  setUser: (user: User) => void;
  logout: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      hasHydrated: false,
      setUser: (user) => set({ user }),
      // set({ user: null }) alone would only overwrite the persisted row with
      // a null-user payload (persist calls setItem, not removeItem, on every
      // state change) — clearStorage() actually deletes it, which is what
      // lets sw.js's pushsubscriptionchange handler tell "logged out" apart
      // from "row exists but empty" with a single get().
      logout: () => {
        set({ user: null });
        useSessionStore.persist.clearStorage();
      },
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: "webrtc-session",
      // IndexedDB instead of localStorage's default: sw.js needs to read the
      // logged-in username to re-register a rotated push subscription, and
      // service workers cannot access localStorage at all (sync API, no DOM).
      // idb-keyval's get() resolves undefined for a missing key; StateStorage's
      // contract needs null there — createJSONStorage's own `?? null` guard
      // only catches a null/undefined *promise*, not an undefined value the
      // promise resolves to, so an unset key reached JSON.parse(undefined)
      // (coerced to the string "undefined") and threw, leaving hydration
      // permanently unresolved and hasHydrated stuck false.
      storage: createJSONStorage(() => ({
        getItem: (name) => get(name).then((v) => v ?? null),
        setItem: idbSet,
        removeItem: del,
      })),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
