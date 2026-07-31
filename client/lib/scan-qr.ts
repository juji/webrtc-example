import jsQR from "jsqr";

export type ScannedContact = { id: string; username?: string; keyFingerprint: string };

function parsePayload(text: string): ScannedContact | null {
  try {
    const data = JSON.parse(text);
    if (typeof data.id === "string" && typeof data.keyFingerprint === "string") {
      return { id: data.id, username: data.username, keyFingerprint: data.keyFingerprint };
    }
    console.error("QR decoded but payload isn't a valid contact:", data);
  } catch (err) {
    console.error("QR decoded but content isn't valid JSON:", text, err);
  }
  return null;
}

export type DecodeFileError = "no-qr-found" | "invalid-payload";

export async function decodeQrFromFile(
  file: File,
): Promise<{ contact: ScannedContact } | { error: DecodeFileError }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const code = jsQR(data, width, height);
  if (!code) {
    console.error("no QR code found in uploaded image:", file.name);
    return { error: "no-qr-found" };
  }

  console.log("decoded QR content:", code.data);
  const contact = parsePayload(code.data);
  return contact ? { contact } : { error: "invalid-payload" };
}

// Scans a live <video> element frame-by-frame until a valid contact QR is
// found or the caller aborts via the returned stop() function.
export function scanQrFromVideo(video: HTMLVideoElement, onResult: (contact: ScannedContact) => void) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  let stopped = false;

  function tick() {
    if (stopped) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(data, width, height);
      if (code) {
        const contact = parsePayload(code.data);
        if (contact) {
          onResult(contact);
          return;
        }
      }
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
  return () => {
    stopped = true;
  };
}
