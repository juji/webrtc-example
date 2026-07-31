"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

// Mockup only — fake data, no backend calls. For visual review before wiring up
// a real /messages/conversations endpoint. Delete this route once the real
// conversation-list page replaces it.
const FAKE_CONVERSATIONS = [
  { username: "bob", lastMessage: "hey, got your file", time: "2m", unread: 2 },
  { username: "carol", lastMessage: "see you tomorrow", time: "1d", unread: 0 },
  { username: "dave", lastMessage: "sent an attachment", time: "3d", unread: 0 },
  { username: "erin", lastMessage: "lol yeah for sure", time: "4d", unread: 0 },
  { username: "frank", lastMessage: "can you send that doc again", time: "5d", unread: 1 },
  { username: "grace", lastMessage: "sounds good, talk soon", time: "6d", unread: 0 },
  { username: "heidi", lastMessage: "thanks!!", time: "1w", unread: 0 },
  { username: "ivan", lastMessage: "on my way", time: "1w", unread: 0 },
  { username: "judy", lastMessage: "did you see the news", time: "2w", unread: 0 },
  { username: "kevin", lastMessage: "haha nice", time: "2w", unread: 3 },
  { username: "laura", lastMessage: "let's catch up sometime", time: "3w", unread: 0 },
  { username: "mallory", lastMessage: "no worries", time: "1mo", unread: 0 },
  { username: "niaj", lastMessage: "got it, thanks", time: "1mo", unread: 0 },
  { username: "olivia", lastMessage: "see the attached file", time: "2mo", unread: 0 },
  { username: "peggy", lastMessage: "yep that works for me", time: "2mo", unread: 0 },
];

export default function MockupPage() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex w-full flex-1 min-h-0">
      <div className="flex w-full flex-col overflow-y-auto md:w-sm md:shrink-0 md:border-r md:border-black/10 md:dark:border-white/10">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-background/30 px-8 py-6 shadow-xl backdrop-blur-lg dark:border-white/10">
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Chats</h1>
        </div>

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
          <p className="px-8 text-sm text-zinc-500">No conversations yet.</p>
        )}

        <div className="sticky bottom-0 mt-auto flex items-center justify-end border-t border-black/10 bg-background px-8 py-4 dark:border-white/10">
          <button
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
    </div>
  );
}
