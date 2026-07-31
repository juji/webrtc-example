"use client";

import { Upload } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import type { User } from "@/lib/api";
import { fetchUserById, sendContactRequest } from "@/lib/api";
import { fingerprint, fromBase64, loadKeys } from "@/lib/keys";
import { decodeQrFromFile, type DecodeFileError, scanQrFromVideo, type ScannedContact } from "@/lib/scan-qr";
import { Popup } from "./popup";

type Tab = "mine" | "scan";
type VerifyResult =
  | { status: "checking" }
  | { status: "verified"; username: string }
  | { status: "mismatch" }
  | { status: "not-found" }
  | { status: "network-error" };
type RequestState = "idle" | "sending" | "sent" | "error";

export function QrCodePopup({ open, onClose, user }: { open: boolean; onClose: () => void; user: User }) {
  const [tab, setTab] = useState<Tab>("mine");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [scanned, setScanned] = useState<ScannedContact | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [uploadError, setUploadError] = useState<DecodeFileError | null>(null);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate "my QR code" whenever that tab is active.
  useEffect(() => {
    if (!open || tab !== "mine") return;
    loadKeys(user.username).then(async (keys) => {
      if (!keys) return;
      const payload = JSON.stringify({
        id: user.id,
        username: user.username,
        keyFingerprint: await fingerprint(keys.kemPublicKey),
      });
      setQrDataUrl(await QRCode.toDataURL(payload));
    });
  }, [open, tab, user]);

  // Run the live camera scan whenever the scan tab is active and nothing's been scanned yet.
  useEffect(() => {
    if (!open || tab !== "scan" || scanned) return;

    let stream: MediaStream | null = null;
    let stop: (() => void) | null = null;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play();
          stop = scanQrFromVideo(videoRef.current, setScanned);
        }
      })
      .catch((err) => {
        // camera unavailable/denied — upload fallback still works
        console.error("camera access failed:", err);
      });

    return () => {
      cancelled = true;
      stop?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, tab, scanned]);

  // Once something's scanned (camera or upload), fetch the real key and verify the fingerprint.
  useEffect(() => {
    if (!scanned) return;
    setVerifyResult({ status: "checking" });
    fetchUserById(scanned.id)
      .then(async (found) => {
        if (!found) {
          setVerifyResult({ status: "not-found" });
          return;
        }
        const actualFingerprint = await fingerprint(fromBase64(found.mlKemPublicKey));
        setVerifyResult(
          actualFingerprint === scanned.keyFingerprint
            ? { status: "verified", username: found.username }
            : { status: "mismatch" },
        );
      })
      .catch((err) => {
        console.error("failed to fetch user for verification:", err);
        setVerifyResult({ status: "network-error" });
      });
  }, [scanned]);

  useEffect(() => {
    if (!open) {
      setTab("mine");
      setScanned(null);
      setVerifyResult(null);
      setUploadError(null);
      setRequestState("idle");
    }
  }, [open]);

  async function handleSendRequest() {
    if (!scanned) return;
    setRequestState("sending");
    try {
      await sendContactRequest(user.username, scanned.id, scanned.keyFingerprint);
      setRequestState("sent");
    } catch (err) {
      console.error("failed to send contact request:", err);
      setRequestState("error");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    const result = await decodeQrFromFile(file);
    if ("contact" in result) {
      setScanned(result.contact);
    } else {
      setUploadError(result.error);
    }
  }

  return (
    <Popup
      open={open}
      onClose={onClose}
      title="QR Code"
      buttons={
        tab === "mine" && qrDataUrl
          ? [
              {
                label: "Download",
                onClick: () => {
                  const a = document.createElement("a");
                  a.href = qrDataUrl;
                  a.download = `${user.username}-qr-code.png`;
                  a.click();
                },
                bgColor: "#ea580c",
                fgColor: "#ffffff",
              },
            ]
          : []
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex rounded-full bg-black/5 p-1 dark:bg-white/5">
          <button
            onClick={() => setTab("mine")}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "mine"
                ? "bg-background text-black shadow-sm dark:text-zinc-50"
                : "text-zinc-500 hover:text-black dark:hover:text-zinc-50"
            }`}
          >
            My QR Code
          </button>
          <button
            onClick={() => setTab("scan")}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "scan"
                ? "bg-background text-black shadow-sm dark:text-zinc-50"
                : "text-zinc-500 hover:text-black dark:hover:text-zinc-50"
            }`}
          >
            Scan QR Code
          </button>
        </div>

        {tab === "mine" ? (
          <div className="flex flex-col items-center gap-3">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="Your contact QR code" className="aspect-square w-full max-w-sm" />
            ) : (
              <div className="aspect-square w-full max-w-sm animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
            )}
            <p className="text-sm text-zinc-500">Let someone scan this to add you as a contact.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {!scanned ? (
              <>
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="aspect-square w-full max-w-sm rounded-lg bg-black object-cover"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-black dark:border-white/10 dark:text-zinc-50"
                >
                  <Upload className="h-4 w-4" />
                  Upload an image instead
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                {uploadError && (
                  <p className="text-sm text-red-500">
                    {uploadError === "no-qr-found"
                      ? "No QR code found in that image."
                      : "That QR code isn't a valid contact code."}
                  </p>
                )}
              </>
            ) : (
              <div className="flex w-full flex-col items-center gap-3 py-8 text-center">
                {verifyResult?.status === "checking" && (
                  <p className="text-sm text-zinc-500">Verifying key…</p>
                )}
                {verifyResult?.status === "verified" && (
                  <>
                    <p className="font-medium text-black dark:text-zinc-50">
                      Verified: {verifyResult.username}
                    </p>
                    <p className="text-sm text-zinc-500">Key fingerprint matches — safe to add as a contact.</p>
                    {requestState === "sent" ? (
                      <p className="text-sm text-green-600 dark:text-green-500">Contact request sent.</p>
                    ) : (
                      <button
                        onClick={handleSendRequest}
                        disabled={requestState === "sending"}
                        className="rounded-full px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: "#ea580c" }}
                      >
                        {requestState === "sending" ? "Sending…" : "Send contact request"}
                      </button>
                    )}
                    {requestState === "error" && (
                      <p className="text-sm text-red-500">Couldn&apos;t send the request. Try again.</p>
                    )}
                  </>
                )}
                {verifyResult?.status === "mismatch" && (
                  <p className="text-sm text-red-500">
                    Key fingerprint doesn&apos;t match. This QR code may be out of date or tampered with.
                  </p>
                )}
                {verifyResult?.status === "not-found" && (
                  <p className="text-sm text-red-500">No user found for this QR code.</p>
                )}
                {verifyResult?.status === "network-error" && (
                  <p className="text-sm text-red-500">Couldn&apos;t reach the server to verify this code.</p>
                )}
                <button
                  onClick={() => {
                    setScanned(null);
                    setVerifyResult(null);
                    setRequestState("idle");
                  }}
                  className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Scan again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Popup>
  );
}
