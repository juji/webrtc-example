"use client";

import { Bell, LogOut, MessageCircle, QrCode } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Popup } from "@/components/popup";
import { QrCodePopup } from "@/components/qr-code-popup";
import { RequestsPopup } from "@/components/requests-popup";
import { fetchContactRequests } from "@/lib/api";
import { enablePushForUser } from "@/lib/push";
import { useSessionStore } from "@/lib/session-store";
import { useRequireSession } from "@/lib/use-require-session";

// Fake data, no backend calls yet — wire up a real /messages/conversations endpoint.
const FAKE_CONVERSATIONS: { username: string; lastMessage: string; time: string; unread: number }[] = [];

// useSearchParams() opts the page out of static rendering unless isolated
// behind its own Suspense boundary — this component's only job is reading
// the ?open=requests query param a notification click deep-links with.
function OpenRequestsFromQuery({ onOpenRequests }: { onOpenRequests: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("open") === "requests") {
      onOpenRequests();
      router.replace("/chat");
    }
  }, [searchParams, router, onOpenRequests]);

  return null;
}

export default function MockupPage() {
  const router = useRouter();
  const user = useRequireSession();
  const logout = useSessionStore((s) => s.logout);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [needsNotificationPrompt, setNeedsNotificationPrompt] = useState(false);
  const [requestCount, setRequestCount] = useState(0);

  useEffect(() => {
    if ("Notification" in window) {
      setNeedsNotificationPrompt(Notification.permission === "default");
    }
  }, []);

  useEffect(() => {
    if (!user || showRequests) return;
    fetchContactRequests(user.username).then((requests) => setRequestCount(requests.length));
  }, [user, showRequests]);

  function handleLogout() {
    logout();
    router.push("/");
  }

  async function handleEnableNotifications() {
    if (!user) return;
    await enablePushForUser(user.username);
    setNeedsNotificationPrompt(Notification.permission === "default");
  }

  if (!user) return null;

  return (
    <div className="flex w-full flex-1 min-h-0">
      <Suspense fallback={null}>
        <OpenRequestsFromQuery onOpenRequests={() => setShowRequests(true)} />
      </Suspense>
      <div className="flex w-full flex-col overflow-y-auto md:w-sm md:shrink-0 md:border-r md:border-black/10 md:dark:border-white/10">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-background/30 px-8 py-6 shadow-xl backdrop-blur-lg dark:border-white/10">
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Chats</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRequests(true)}
              aria-label="Contact requests"
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-black dark:border-white/10 dark:text-zinc-50"
            >
              <Bell className="h-4 w-4" />
              {requestCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
                  {requestCount > 9 ? "9+" : requestCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowQr(true)}
              aria-label="Show my QR code"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-black dark:border-white/10 dark:text-zinc-50"
            >
              <QrCode className="h-4 w-4" />
            </button>
          </div>
        </div>

        {needsNotificationPrompt && (
          <div className="flex items-center justify-between gap-4 border-b border-black/10 bg-black/2 px-8 py-3 dark:border-white/10 dark:bg-white/3">
            <div className="flex items-center gap-4">
              <Bell className="h-4 w-4 shrink-0 text-zinc-500" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Enable notifications for contact requests</p>
            </div>
            <button
              onClick={handleEnableNotifications}
              className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-white"
              style={{ backgroundColor: "#16a34a" }}
            >
              Enable
            </button>
          </div>
        )}

        <ul className="flex flex-col gap-1 py-1">
          {FAKE_CONVERSATIONS.map((c) => (
            <li key={c.username}>
              <button
                onClick={() => setSelected(c.username)}
                className={`flex w-full flex-col gap-0.5 px-8 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5 ${
                  selected === c.username ? "bg-black/5 dark:bg-white/5" : ""
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-black dark:text-zinc-50">{c.username}</span>
                  <span className="text-xs text-zinc-500">{c.time}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm text-zinc-500">{c.lastMessage}</span>
                  {c.unread > 0 && (
                    <span className="ml-2 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-foreground px-1.5 text-xs font-medium text-background">
                      {c.unread}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>

        {FAKE_CONVERSATIONS.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/5 dark:bg-white/5">
              <MessageCircle className="h-6 w-6 text-zinc-400" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-medium text-black dark:text-zinc-50">No chats yet</p>
              <p className="text-sm text-zinc-500">Start a conversation to see it here.</p>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 mt-auto flex items-center justify-end border-t border-black/10 bg-background px-8 py-4 dark:border-white/10">
          <button
            onClick={() => setConfirmingLogout(true)}
            aria-label="Log out"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-black dark:border-white/10 dark:text-zinc-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="hidden flex-1 items-center justify-center md:flex">
        {selected ? (
          <p className="text-sm text-zinc-500">chat with {selected} renders here</p>
        ) : (
          <p className="text-sm text-zinc-500">Select a conversation</p>
        )}
      </div>

      <Popup
        open={confirmingLogout}
        onClose={() => setConfirmingLogout(false)}
        title="Log out"
        onConfirm={handleLogout}
        confirmLabel="Log out"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Are you sure you want to log out?</p>
      </Popup>

      <QrCodePopup open={showQr} onClose={() => setShowQr(false)} user={user} />
      <RequestsPopup open={showRequests} onClose={() => setShowRequests(false)} user={user} />
    </div>
  );
}
