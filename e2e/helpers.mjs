// Shared helpers for e2e tests, driven against a running dev server
// (`bun run dev`). The app's auth is a username + ML-KEM/ML-DSA keypair
// (see client/lib/keys.ts), and adding a contact is a QR-code handshake
// (see client/components/qr-code-popup.tsx) — there's no username search
// or per-contact chat route anymore, chats open inline in /chat.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import QRCode from "qrcode";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const SERVER_URL = process.env.E2E_SERVER_URL ?? "http://localhost:4000";

// jsQR ships a UMD bundle (window.jsQR), so it can be injected into a
// Playwright page as a plain <script> to decode the app's own rendered QR
// image in-browser — no separate fingerprint recomputation to keep in sync
// with client/lib/keys.ts.
const jsQrSource = readFileSync(createRequire(import.meta.url).resolve("jsqr"), "utf8");

export async function newUser(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (process.env.E2E_DEBUG) {
    page.on("console", (m) => console.log(`[console] ${m.text()}`));
    page.on("pageerror", (e) => console.log(`[pageerror] ${e}`));
    page.on("requestfailed", (r) => console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  }
  return { context, page };
}

// A page reused within the same context (same user logging in again after
// closing their tab) still has their session persisted (session-store.ts's
// Zustand persist middleware), so it redirects straight to /chat instead of
// showing the username form — handle both cases rather than assuming a
// fresh, never-logged-in page.
export async function login(page, username) {
  await page.goto(BASE_URL);
  const usernameInput = page.locator('input[placeholder="username"]');
  const primssgHeader = page.locator('h1:has-text("Primssg")');
  await Promise.race([usernameInput.waitFor(), primssgHeader.waitFor()]);
  if (await usernameInput.isVisible()) {
    await usernameInput.fill(username);
    await page.click('button:has-text("Continue")');
    await primssgHeader.waitFor();
  }
}

// Reads back {id, username, keyFingerprint} from the logged-in user's own
// rendered "My QR Code" image, by decoding it in-page with jsQR — this is
// exactly what a peer's camera/upload scan would read.
export async function getMyContactInfo(page) {
  await page.click('button[aria-label="Menu"]');
  await page.click('button:has-text("QR Code")');
  await page.waitForSelector('img[alt="Your contact QR code"]');
  await page.addScriptTag({ content: jsQrSource });
  const payload = await page.evaluate(async () => {
    const img = document.querySelector('img[alt="Your contact QR code"]');
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(data, width, height);
    return JSON.parse(code.data);
  });
  await page.click('button[aria-label="Close"]');
  return payload;
}

// Builds a QR code image file encoding a contact payload (same shape as
// qr-code-popup.tsx's "mine" tab: {id, username, keyFingerprint}) and writes
// it to disk so it can be fed into the "Upload an image instead" file input —
// driving a real camera through Playwright isn't practical, this exercises
// the same decode/verify/request path via the upload fallback instead.
export async function makeContactQrFile(filePath, { id, username, keyFingerprint }) {
  const payload = JSON.stringify({ id, username, keyFingerprint });
  const buffer = await QRCode.toBuffer(payload);
  writeFileSync(filePath, buffer);
  return filePath;
}

// Drives the full QR-scan contact-request flow on `page` for the peer
// described by `peer` ({id, username, keyFingerprint}), via the upload
// fallback. Leaves the request pending — the peer must still accept it.
export async function sendContactRequestViaQr(page, qrFilePath, peer) {
  await page.click('button[aria-label="Menu"]');
  await page.click('button:has-text("QR Code")');
  await page.click('button:has-text("Scan QR Code")');
  await page.click('button:has-text("Upload an image instead")');
  await page.setInputFiles('input[type="file"][accept="image/*"]', qrFilePath);
  await page.waitForSelector(`text=Verified: ${peer.username}`);
  await page.click('button:has-text("Send contact request")');
  await page.waitForSelector("text=Contact request sent.");
  await page.click('button[aria-label="Close"]');
}

// Accepts the (only) pending incoming contact request from `fromUsername`.
export async function acceptContactRequest(page, fromUsername) {
  await page.click('button[aria-label="Notifications"]');
  await page.waitForSelector(`li:has-text("${fromUsername}")`);
  await page.click(`li:has-text("${fromUsername}") button:has-text("Accept")`);
  await page.waitForSelector(`li:has-text("${fromUsername}") >> text=Accepted`);
  await page.click('button[aria-label="Close"]');
}

// Opening Notifications re-fetches this user's requests and syncs any
// outgoing one that's since been accepted into the local contact list
// (requests-popup.tsx's syncAcceptedContact) — the durable fallback path a
// real user hits if they missed the live push. Used after the peer accepts,
// so `page`'s own contact list actually picks up the new contact.
export async function syncContactsViaNotifications(page) {
  await page.click('button[aria-label="Menu"]');
  await page.click('button[aria-label="Notifications"]');
  await page.waitForSelector("li");
  await page.click('button[aria-label="Close"]');
}

// Runs the full QR handshake so `pageA`'s user and `pageB`'s user end up as
// mutual contacts: A scans B's QR (via upload) and sends a request, B
// accepts it, then A syncs the acceptance into their own local contact list.
// `infoB` is B's {id, username, keyFingerprint} from getMyContactInfo(pageB).
// `qrDir` is where the generated QR image gets written.
export async function becomeContacts(qrDir, pageA, userA, pageB, infoB) {
  const qrPath = await makeContactQrFile(path.join(qrDir, `${infoB.username}-qr.png`), infoB);
  await sendContactRequestViaQr(pageA, qrPath, infoB);
  await acceptContactRequest(pageB, userA);
  await syncContactsViaNotifications(pageA);
}

export async function openChatWith(page, peerUsername) {
  await page.click('button[aria-label="Menu"]');
  await page.click('button:has-text("Contacts")');
  // Scoped to the popup (its fixed.inset-0 wrapper, popup.tsx), not just any
  // button with this text — once a conversation with this peer already
  // exists, chat/page.tsx's own sidebar list has a same-text button sitting
  // underneath the popup, and an unscoped locator can resolve to that
  // occluded one instead of the popup's.
  await page.locator(".fixed.inset-0").locator(`button:has-text("${peerUsername}")`).click();
}

export async function sendMessage(page, text) {
  // Enter (no shift) submits the form directly (chat-pane.tsx's
  // handleKeyDown) — clicking the send button instead risks hitting the
  // floating dev-panel toggle underneath it (NEXT_PUBLIC_DEV=true sits in
  // the same bottom-right corner, client/components/dev-panel.tsx).
  await page.fill('textarea[placeholder="Message"]', text);
  await page.press('textarea[placeholder="Message"]', "Enter");
}

export async function sendFile(page, filePath) {
  await page.click('button[aria-label="Attach"]');
  await page.click('button:has-text("Upload files")');
  await page.setInputFiles('input[type="file"]:not([accept])', filePath);
  // Selecting a file only stages it (chat-pane.tsx's selectedFiles) — actually
  // sending still goes through the same form submit as a text message.
  await page.press('textarea[placeholder="Message"]', "Enter");
}
