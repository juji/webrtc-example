"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js");

    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "notification-click" && event.data.url) {
        router.push(event.data.url);
      }
    }
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [router]);

  return null;
}
