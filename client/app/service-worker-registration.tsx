"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SERVER_URL } from "@/lib/api";
import { syncAcceptedContact } from "@/lib/contacts";
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
      // sw.js is a static file, never processed by Next's bundler — it has
      // no way to read NEXT_PUBLIC_SERVER_URL itself, so the page (which
      // does) hands it over. Config, not session data — the logged-in
      // username sw.js also needs comes from IndexedDB directly instead
      // (see lib/session-store.ts), since it survives independent of
      // whether this effect happens to run again.
      const target = registration.active ?? navigator.serviceWorker.controller;
      target?.postMessage({ type: "config", serverUrl: SERVER_URL });
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
