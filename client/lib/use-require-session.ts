import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSessionStore } from "./session-store";

// Waits for the persisted session to load from IndexedDB before deciding
// the user is logged out — otherwise a refresh bounces you to "/" every time.
export function useRequireSession() {
  const router = useRouter();
  const user = useSessionStore((s) => s.user);
  const hasHydrated = useSessionStore((s) => s.hasHydrated);

  useEffect(() => {
    if (hasHydrated && !user) router.replace("/");
  }, [hasHydrated, user, router]);

  return hasHydrated ? user : null;
}
