"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
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
    navigator.serviceWorker.register("/sw.js");

    async function handleContactAccepted(data: ContactAcceptedData) {
      if (!user) return;
      await syncAcceptedContact(user.username, data.contact, data.keyFingerprint);
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
