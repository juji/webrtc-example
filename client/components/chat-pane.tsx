"use client";

import { ArrowLeft, Paperclip, Send } from "lucide-react";
import { useRef, useState } from "react";

// UI-only pane — no useWebRtcChat wiring yet. Shape matches ChatMessage
// (client/lib/messages-store.ts) plus a createdAt this pane needs for the
// date/time labels, which the real store doesn't track yet.
export type ChatPaneMessage = {
  clientId: string;
  text?: string;
  file?: { name: string; type: string };
  fromSelf: boolean;
  status: "sending" | "in-transit" | "sent" | "read";
  createdAt: Date;
};

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const MAX_TEXTAREA_HEIGHT = 160;

export function ChatPane({
  username,
  messages,
  connected,
  onBack,
}: {
  username: string;
  messages: ChatPaneMessage[];
  connected: boolean;
  onBack?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-background/30 px-4 py-3 shadow-xl backdrop-blur-lg dark:border-white/10">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Back to chats"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-black md:hidden dark:text-zinc-50"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <h1 className="text-base font-semibold text-black dark:text-zinc-50">{username}</h1>
        </div>
        <span className={`text-sm ${connected ? "text-green-600 dark:text-green-500" : "text-zinc-500"}`}>
          {connected ? "Connected" : "Connecting…"}
        </span>
      </div>

      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pt-0 pb-6">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDateSeparator = !prev || !isSameDay(prev.createdAt, m.createdAt);
          return (
            <li key={m.clientId} className="contents">
              {showDateSeparator && (
                <div className="sticky top-0 z-10 -mx-4 mb-2 self-stretch bg-background/30 px-4 py-2 text-center backdrop-blur-lg">
                  <span className="text-xs font-medium text-zinc-500">{formatDateLabel(m.createdAt)}</span>
                </div>
              )}
              <div
                className={`flex w-fit max-w-[80%] flex-col gap-0.5 rounded-2xl px-4 py-2 ${
                  m.fromSelf
                    ? "self-end rounded-br-md bg-orange-500/64 text-black dark:text-zinc-50"
                    : "self-start rounded-bl-md bg-black/5 text-black dark:bg-white/10 dark:text-zinc-50"
                }`}
              >
                {m.file ? (
                  <span className="flex items-center gap-2 text-sm underline">
                    <Paperclip className="h-3.5 w-3.5 shrink-0" />
                    {m.file.name}
                  </span>
                ) : (
                  <span className="text-sm">{m.text}</span>
                )}
                <span className="self-end text-xs opacity-60">
                  {formatTime(m.createdAt)}
                  {m.fromSelf && ` · ${m.status}`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-black/10 px-4 py-4 dark:border-white/10">
        <button
          type="button"
          aria-label="Attach file"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-black dark:border-white/10 dark:text-zinc-50"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message"
          rows={1}
          style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
          className="flex-1 resize-none overflow-y-auto rounded-2xl border border-black/10 bg-transparent px-4 py-2 text-sm text-black outline-none placeholder:text-zinc-500 focus:border-black/40 dark:border-white/10 dark:text-zinc-50 dark:focus:border-white/40"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send message"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: "#ea580c" }}
        >
          <Send className="h-4 w-4 -translate-x-px translate-y-px" />
        </button>
      </form>
    </div>
  );
}
