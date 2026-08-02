"use client";

import { useEffect } from "react";
import { useSessionStore } from "@/lib/session-store";
import { useSignalingStore } from "@/lib/signaling-store";

export function SignalingConnection() {
  const user = useSessionStore((s) => s.user);
  const connect = useSignalingStore((s) => s.connect);
  const disconnect = useSignalingStore((s) => s.disconnect);

  useEffect(() => {
    if (!user) return;
    connect(user.id);
    return () => disconnect();
  }, [user, connect, disconnect]);

  return null;
}
