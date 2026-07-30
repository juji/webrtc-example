"use client";

import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { useRequireSession } from "@/lib/use-require-session";
import { useWebRtcChat } from "@/lib/use-webrtc-chat";

export default function ChatPage() {
  const params = useParams<{ username: string }>();
  const peerUsername = decodeURIComponent(params.username);
  const user = useRequireSession();

  if (!user) return null;

  return <Chat selfUsername={user.username} peerUsername={peerUsername} />;
}

function Chat({ selfUsername, peerUsername }: { selfUsername: string; peerUsername: string }) {
  const { connected, messages, sendMessage, sendFile } = useWebRtcChat(selfUsername, peerUsername);
  const [draft, setDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    sendMessage(draft);
    setDraft("");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) sendFile(file);
    e.target.value = "";
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">{peerUsername}</h1>
        <span className={`text-sm ${connected ? "text-green-600" : "text-zinc-500"}`}>
          {connected ? "connected" : "connecting..."}
        </span>
      </div>
      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {messages.map((m, i) => (
          <li
            key={i}
            className={`w-fit max-w-[80%] rounded px-3 py-1.5 ${
              m.fromSelf
                ? "self-end bg-foreground text-background"
                : "self-start bg-black/5 text-black dark:bg-white/10 dark:text-zinc-50"
            }`}
          >
            {m.file ? (
              m.file.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element -- object URL, not a static asset Next can optimize
                <img src={m.file.url} alt={m.file.name} className="max-h-60 max-w-full rounded" />
              ) : (
                <a href={m.file.url} download={m.file.name} className="underline">
                  {m.file.name}
                </a>
              )
            ) : (
              m.text
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input ref={fileInputRef} type="file" onChange={handleFileChange} disabled={!connected} className="hidden" />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!connected}
          aria-label="Attach file"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 text-black disabled:opacity-50 dark:border-white/10 dark:text-zinc-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          disabled={!connected}
          className="flex-1 rounded border border-black/10 bg-transparent px-3 py-2 text-black outline-none focus:border-black/40 disabled:opacity-50 dark:border-white/10 dark:text-zinc-50 dark:focus:border-white/40"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
