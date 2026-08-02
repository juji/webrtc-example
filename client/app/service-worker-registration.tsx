"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { syncAcceptedContact } from "@/lib/contacts";
import { SERVER_URL } from "@/lib/api";
import { useSessionStore } from "@/lib/session-store";

type ContactAcceptedData = {
  type: "contact-accepted";
  contact: { id: string; username: string };
  keyFingerprint: string;
};

export function ServiceWorkerRegistration() {
  const router = useRouter();
  const user = useSessionStore((s) => s.user);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      // The SW's pushsubscriptionchange handler needs to know who to
      // re-register a rotated subscription for — it has no access to
      // localStorage/session state on its own. Told on every mount (not
      // just login) so a SW that was still starting up at registration time
      // still gets it once ready, and re-affirmed if the user changes.
      if (!user) return;
      const target = registration.active ?? navigator.serviceWorker.controller;
      target?.postMessage({ type: "auth", username: user.username, serverUrl: SERVER_URL });
    });

    async function handleContactAccepted(data: ContactAcceptedData) {
      if (!user) return;
      await syncAcceptedContact(user.id, data.contact, data.keyFingerprint);
    }

    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "notification-click" && event.data.url) {
        router.push(event.data.url);
      }
      if (event.data?.data?.type === "contact-accepted") {
        handleContactAccepted(event.data.data);
      }
    }
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [router, user]);

  return null;
}
