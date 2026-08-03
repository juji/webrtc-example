// Drives two real browser sessions against a running dev server (`bun run dev`)
// and asserts the full register -> QR contact handshake -> WebRTC chat flow
// works end to end.
//
// Run: bun run test:e2e

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { becomeContacts, getMyContactInfo, login, newUser, openChatWith, sendFile, sendMessage } from "./helpers.mjs";

const run = Date.now();
const aliceName = `alice-${run}`;
const bobName = `bob-${run}`;
const qrDir = mkdtempSync(path.join(tmpdir(), "webrtc-e2e-qr-"));

const browser = await chromium.launch();

try {
  const alice = await newUser(browser);
  const bob = await newUser(browser);

  await login(alice.page, aliceName);
  await login(bob.page, bobName);

  const bobInfo = await getMyContactInfo(bob.page);
  await becomeContacts(qrDir, alice.page, aliceName, bob.page, bobInfo);

  await openChatWith(alice.page, bobName);
  await openChatWith(bob.page, aliceName);

  await alice.page.waitForSelector('span[aria-label="Connected"]', { timeout: 15_000 });
  await bob.page.waitForSelector('span[aria-label="Connected"]', { timeout: 15_000 });

  const aliceMessage = "hello from alice";
  const bobMessage = "hi alice, this is bob";

  await sendMessage(alice.page, aliceMessage);
  await bob.page.waitForSelector(`text=${aliceMessage}`, { timeout: 10_000 });

  await sendMessage(bob.page, bobMessage);
  await alice.page.waitForSelector(`text=${bobMessage}`, { timeout: 10_000 });

  const attachmentName = `attachment-${run}.txt`;
  const attachmentPath = path.join(qrDir, attachmentName);
  writeFileSync(attachmentPath, "hello, this is a test attachment");

  await sendFile(alice.page, attachmentPath);
  await bob.page.waitForSelector(`button:has-text("${attachmentName}")`, { timeout: 10_000 });

  assert.ok(true, "messages and a file attachment were exchanged over the WebRTC data channel");
  console.log("PASS: register/login, QR contact handshake, WebRTC data-channel chat, and file attachments all work end to end");
} finally {
  await browser.close();
}
