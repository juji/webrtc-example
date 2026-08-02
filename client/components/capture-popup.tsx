"use client";

import { useEffect, useRef, useState } from "react";
import { Popup } from "./popup";

export type CaptureMode = "photo" | "video";

const MODE_LABEL: Record<CaptureMode, string> = {
  photo: "Take Photo",
  video: "Record Video",
};

const MODE_CONSTRAINTS: Record<CaptureMode, MediaStreamConstraints> = {
  photo: { video: true },
  video: { audio: true, video: true },
};

export function CapturePopup({
  mode,
  onClose,
  onCapture,
  onUploadInstead,
}: {
  mode: CaptureMode | null;
  onClose: () => void;
  onCapture: (file: File) => void;
  onUploadInstead: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Open the camera as soon as a mode is picked, close it the instant the
  // popup goes away (mode becomes null) — never leave the camera open in the background.
  useEffect(() => {
    if (!mode) return;
    setResult(null);
    setRecording(false);

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia(MODE_CONSTRAINTS[mode])
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      })
      .catch((err) => console.error("camera access failed:", err));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [mode]);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      setResult({ blob, url: URL.createObjectURL(blob) });
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) setResult({ blob, url: URL.createObjectURL(blob) });
    }, "image/png");
  }

  function retake() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
  }

  function use() {
    if (!mode || !result) return;
    const extension = mode === "photo" ? "png" : "webm";
    const file = new File([result.blob], `${mode}-${Date.now()}.${extension}`, { type: result.blob.type });
    onCapture(file);
    onClose();
  }

  if (!mode) return null;

  return (
    <Popup
      open={!!mode}
      onClose={onClose}
      title={MODE_LABEL[mode]}
      buttons={
        result
          ? [
              { label: "Retake", onClick: retake },
              { label: "Use", onClick: use, bgColor: "#ea580c", fgColor: "#ffffff" },
            ]
          : [{ label: "Upload instead", onClick: onUploadInstead }]
      }
    >
      <div className="flex flex-col items-center gap-3">
        {result ? (
          mode === "photo" ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL, not a static asset Next can optimize
            <img src={result.url} alt="Captured photo" className="aspect-square w-full max-w-sm rounded-lg object-cover" />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={result.url} controls className="aspect-square w-full max-w-sm rounded-lg bg-black object-cover" />
          )
        ) : (
          <video
            ref={videoRef}
            muted
            playsInline
            className="aspect-square w-full max-w-sm rounded-lg bg-black object-cover"
          />
        )}

        {!result && (
          <button
            onClick={mode === "photo" ? takePhoto : recording ? stopRecording : startRecording}
            className="rounded-full px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: recording ? "#dc2626" : "#ea580c" }}
          >
            {mode === "photo" ? "Capture" : recording ? "Stop" : "Start Recording"}
          </button>
        )}
      </div>
    </Popup>
  );
}
