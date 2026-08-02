"use client";

import { ArrowLeft, Download, Image as ImageIcon, Mic, Paperclip, Send, Square, Upload, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { vistaView, type VistaImgConfig } from "vistaview";
import { nativeVideo, type VistaVideoConfig } from "vistaview/extensions/native-video";
import { isExtensionAllowed } from "@/lib/attachment-validation";
import { useWebRtcChat } from "@/lib/use-webrtc-chat";
import { CapturePopup, type CaptureMode } from "./capture-popup";

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

// vistaview's native-video extension renders an <img src=""> when no poster is
// given — a 1x1 transparent PNG data URI avoids that empty-src browser request.
const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// Every extension a MediaRecorder-produced audio file could plausibly need across browsers.
const KNOWN_AUDIO_EXTENSIONS = ["webm", "ogg", "mp4", "m4a", "aac", "wav"];
const KNOWN_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "svg", "avif"];
const KNOWN_VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "avi", "mkv", "m4v", "3gp"];

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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Every image/video across the conversation, in render order, so the lightbox
  // can page through the whole gallery instead of just the clicked message's file.
  const galleryItems = useMemo(() => {
    const items: (VistaImgConfig | VistaVideoConfig)[] = [];
    for (const m of messages) {
      const file = m.file;
      if (!file) continue;
      if (file.type.startsWith("image/")) {
        items.push({ src: file.url, alt: file.name });
      } else if (file.type.startsWith("video/")) {
        items.push({ src: file.url, type: "video", poster: TRANSPARENT_PNG });
      }
    }
    return items;
  }, [messages]);

  function openGallery(url: string) {
    const index = galleryItems.findIndex((item) => item.src === url);
    if (index === -1) return;
    vistaView({ elements: galleryItems, extensions: [nativeVideo()] })?.open(index);
  }

  // The <a download> attribute is only honored for same-origin (or blob:/data:) URLs —
  // attachments are served from a different origin (RUSTFS_ENDPOINT), so it's silently
  // ignored there and the browser just navigates/opens the file instead of saving it.
  async function downloadFile(url: string, name: string) {
    const blob = await fetch(url).then((res) => res.blob());
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    a.click();
    URL.revokeObjectURL(blobUrl);
  }
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

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

  useEffect(() => {
    setIsMobile(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() && selectedFiles.length === 0) return;
    if (draft.trim()) sendMessage(draft.trim());
    for (const file of selectedFiles) sendFile(file);
    setDraft("");
    setSelectedFiles([]);
    setFileError(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function acceptFiles(files: File[], extraBlockedExtensions: string[] = []) {
    const isAllowed = (file: File) => {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      return !extraBlockedExtensions.includes(extension) && isExtensionAllowed(file.name);
    };
    const allowed = files.filter(isAllowed);
    const rejectedExtensions = [
      ...new Set(
        files
          .filter((file) => !isAllowed(file))
          .map((file) => file.name.split(".").pop()?.toLowerCase())
          .filter(Boolean),
      ),
    ];
    setFileError(
      rejectedExtensions.length > 0 ? `.${rejectedExtensions.join(", .")} files aren't allowed.` : null,
    );
    if (allowed.length > 0) setSelectedFiles((prev) => [...prev, ...allowed]);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) acceptFiles(files, [...KNOWN_IMAGE_EXTENSIONS, ...KNOWN_VIDEO_EXTENSIONS]);
  }

  function handleMediaFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) acceptFiles(files);
  }

  function removeSelectedFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Safari can't produce webm at all (no MediaRecorder support for it), so it
    // falls through to the browser's default mimeType (its native mp4/aac).
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordedChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType });
      const extension = recorder.mimeType.split("/")[1]?.split(";")[0] ?? "webm";
      const file = new File([blob], `voice-message-${Date.now()}.${extension}`, { type: recorder.mimeType });
      acceptFiles([file]);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }

  const canAddPhotos = isExtensionAllowed(KNOWN_IMAGE_EXTENSIONS.map((ext) => `photo.${ext}`));
  const canAddVideos = isExtensionAllowed(KNOWN_VIDEO_EXTENSIONS.map((ext) => `video.${ext}`));

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
          const file = m.file;
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
                {file ? (
                  file.type.startsWith("audio/") ? (
                    <audio controls src={file.url} className="h-10 max-w-64" />
                  ) : file.type.startsWith("image/") ? (
                    <div className="flex flex-col gap-1.5">
                      <button type="button" onClick={() => openGallery(file.url)} className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element -- object/remote URL, not a static asset Next can optimize */}
                        <img
                          src={file.url}
                          alt={file.name}
                          className="max-h-64 max-w-64 rounded-lg object-cover"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadFile(file.url, file.name)}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-black/10 py-1.5 text-sm font-medium hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </button>
                    </div>
                  ) : file.type.startsWith("video/") ? (
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => openGallery(file.url)}
                        className="relative block max-h-64 max-w-64"
                      >
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video src={file.url} muted className="max-h-64 max-w-64 rounded-lg object-cover" />
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white">
                            <Video className="h-4 w-4" />
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadFile(file.url, file.name)}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-black/10 py-1.5 text-sm font-medium hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/15"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => downloadFile(file.url, file.name)}
                      className="flex items-center gap-2 text-sm underline"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      {file.name}
                    </button>
                  )
                ) : (
                  <span className="text-sm">{m.text}</span>
                )}
                <span className="self-end mt-1.5 text-xs opacity-60">
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
        {selectedFiles.length > 0 && (
          <div className="mx-4 mt-3 flex flex-wrap gap-2">
            {selectedFiles.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="flex w-fit items-center gap-2 rounded-full bg-black/5 px-3 py-1.5 text-sm text-black dark:bg-white/10 dark:text-zinc-50"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-48 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeSelectedFile(i)}
                  aria-label="Remove attachment"
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-500 hover:text-black dark:hover:text-zinc-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-2 px-4 py-4">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={handleMediaFileChange}
          />
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleMediaFileChange}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={handleMediaFileChange}
          />
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
              <div className="absolute bottom-full left-0 z-20 mb-2 flex w-52 flex-col overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => {
                    setAttachMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex items-center gap-3 px-4 py-3 text-left text-sm text-black hover:bg-black/5 dark:text-zinc-50 dark:hover:bg-white/10"
                >
                  <Upload className="h-4 w-4" />
                  Upload files
                </button>
                {isMobile ? (
                  (canAddPhotos || canAddVideos) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        mediaInputRef.current?.click();
                      }}
                      className="flex items-center gap-3 px-4 py-3 text-left text-sm text-black hover:bg-black/5 dark:text-zinc-50 dark:hover:bg-white/10"
                    >
                      <ImageIcon className="h-4 w-4" />
                      Add Media
                    </button>
                  )
                ) : (
                  <>
                    {canAddPhotos && (
                      <button
                        type="button"
                        onClick={() => {
                          setAttachMenuOpen(false);
                          setCaptureMode("photo");
                        }}
                        className="flex items-center gap-3 px-4 py-3 text-left text-sm text-black hover:bg-black/5 dark:text-zinc-50 dark:hover:bg-white/10"
                      >
                        <ImageIcon className="h-4 w-4" />
                        Add Photos
                      </button>
                    )}
                    {canAddVideos && (
                      <button
                        type="button"
                        onClick={() => {
                          setAttachMenuOpen(false);
                          setCaptureMode("video");
                        }}
                        className="flex items-center gap-3 px-4 py-3 text-left text-sm text-black hover:bg-black/5 dark:text-zinc-50 dark:hover:bg-white/10"
                      >
                        <Video className="h-4 w-4" />
                        Add Videos
                      </button>
                    )}
                  </>
                )}
                {isExtensionAllowed(KNOWN_AUDIO_EXTENSIONS.map((ext) => `voice-message.${ext}`)) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      startRecording();
                    }}
                    className="flex items-center gap-3 px-4 py-3 text-left text-sm text-black hover:bg-black/5 dark:text-zinc-50 dark:hover:bg-white/10"
                  >
                    <Mic className="h-4 w-4" />
                    Record audio
                  </button>
                )}
              </div>
            )}
          </div>
          <CapturePopup
            mode={captureMode}
            onClose={() => setCaptureMode(null)}
            onCapture={(file) => acceptFiles([file])}
            onUploadInstead={() => {
              const mode = captureMode;
              setCaptureMode(null);
              if (mode === "photo") photoInputRef.current?.click();
              else if (mode === "video") videoInputRef.current?.click();
            }}
          />
          {isRecording && (
            <button
              type="button"
              onClick={stopRecording}
              className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-red-600 px-3 text-sm text-white"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop recording
            </button>
          )}
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
            disabled={!draft.trim() && selectedFiles.length === 0}
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
