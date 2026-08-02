"use client";

import { ArrowLeft, Paperclip, Send, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isExtensionAllowed } from "@/lib/attachment-validation";
import { useWebRtcChat } from "@/lib/use-webrtc-chat";

function isSameDay(a: string, b: string): boolean {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(iso, today.toISOString())) return "Today";
  if (isSameDay(iso, yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const MAX_TEXTAREA_HEIGHT = 160;

export function ChatPane({
  selfId,
  selfUsername,
  peerId,
  username,
  onBack,
}: {
  selfId: string;
  selfUsername: string;
  peerId: string;
  username: string;
  onBack?: () => void;
}) {
  const { connected, messages, sendMessage, sendFile } = useWebRtcChat(selfId, selfUsername, peerId, username);
  const [draft, setDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!attachMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [attachMenuOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView();
  }, [messages.length]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() && !selectedFile) return;
    if (draft.trim()) sendMessage(draft.trim());
    if (selectedFile) sendFile(selectedFile);
    setDraft("");
    setSelectedFile(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function acceptFile(file: File) {
    if (!isExtensionAllowed(file.name)) {
      setFileError("That file type isn't allowed.");
      return;
    }
    setFileError(null);
    setSelectedFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) acceptFile(file);
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
          <h1 className="text-base font-semibold text-black dark:text-zinc-50" style={{ fontFamily: "var(--font-libertinus-math)" }}>{username}</h1>
        </div>
        <span
          aria-label={connected ? "Connected" : "Connecting…"}
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${connected ? "bg-green-600 dark:bg-green-500" : "bg-zinc-400 dark:bg-zinc-600"}`}
        />
      </div>

      <ul className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pt-0 pb-6">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDateSeparator = !prev || !isSameDay(prev.createdAt, m.createdAt);
          return (
            <li key={m.messageId} className="contents">
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
                {m.files[0] ? (
                  <a
                    href={m.files[0].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={m.files[0].name}
                    className="flex items-center gap-2 text-sm underline"
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0" />
                    {m.files[0].name}
                  </a>
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
        <div ref={messagesEndRef} />
      </ul>

      <div className="border-t border-black/10 dark:border-white/10">
        {fileError && <p className="px-4 pt-3 text-sm text-red-500">{fileError}</p>}
        {selectedFile && (
          <div className="mx-4 mt-3 flex w-fit items-center gap-2 rounded-full bg-black/5 px-3 py-1.5 text-sm text-black dark:bg-white/10 dark:text-zinc-50">
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-48 truncate">{selectedFile.name}</span>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              aria-label="Remove attachment"
              className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-500 hover:text-black dark:hover:text-zinc-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-2 px-4 py-4">
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
          <div ref={attachMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setAttachMenuOpen((v) => !v)}
              aria-label="Attach"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-black dark:border-white/10 dark:text-zinc-50"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            {attachMenuOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-2 flex w-44 flex-col overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => {
                    setAttachMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-left text-sm text-black hover:bg-black/5 dark:text-zinc-50 dark:hover:bg-white/10"
                >
                  <Upload className="h-4 w-4" />
                  Upload files
                </button>
              </div>
            )}
          </div>
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
            disabled={!draft.trim() && !selectedFile}
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "#ea580c" }}
          >
            <Send className="h-4 w-4 -translate-x-px translate-y-px" />
          </button>
        </form>
      </div>
    </div>
  );
}
