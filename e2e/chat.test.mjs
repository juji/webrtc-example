// Drives two real browser sessions against a running dev server (`bun run dev`)
// and asserts the full register -> search -> WebRTC chat flow works end to end.
//
// Run: bun run test:e2e

import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const run = Date.now();
const aliceName = `alice-${run}`;
const bobName = `bob-${run}`;

async function newUser(browser) {
  const context = await browser.newContext();
  return context.newPage();
}

async function login(page, username) {
  await page.goto(BASE_URL);
  await page.fill('input[placeholder="username"]', username);
  await page.click('button:has-text("Continue")');
  await page.waitForSelector(`text=Hi, ${username}`);
}

async function openChatWith(page, peerUsername) {
  await page.fill('input[placeholder="Search users..."]', peerUsername);
  await page.waitForSelector(`button:has-text("${peerUsername}")`);
  await page.click(`button:has-text("${peerUsername}")`);
  await page.waitForURL(`**/chat/${peerUsername}`);
}

async function sendMessage(page, text) {
  await page.fill('input[placeholder="Message"]', text);
  await page.click('button:has-text("Send")');
}

async function sendFile(page, filePath) {
  await page.setInputFiles('input[type="file"]', filePath);
}

const browser = await chromium.launch();

try {
  const alice = await newUser(browser);
  const bob = await newUser(browser);

  await login(alice, aliceName);
  await login(bob, bobName);

  await openChatWith(alice, bobName);
  await openChatWith(bob, aliceName);

  await alice.waitForSelector("text=connected", { timeout: 15_000 });
  await bob.waitForSelector("text=connected", { timeout: 15_000 });

  const aliceMessage = "hello from alice";
  const bobMessage = "hi alice, this is bob";

  await sendMessage(alice, aliceMessage);
  await bob.waitForSelector(`text=${aliceMessage}`, { timeout: 10_000 });

  await sendMessage(bob, bobMessage);
  await alice.waitForSelector(`text=${bobMessage}`, { timeout: 10_000 });

  const attachmentName = `attachment-${run}.txt`;
  const attachmentPath = path.join(mkdtempSync(path.join(tmpdir(), "webrtc-e2e-")), attachmentName);
  writeFileSync(attachmentPath, "hello, this is a test attachment");

  await sendFile(alice, attachmentPath);
  await bob.waitForSelector(`a:has-text("${attachmentName}")`, { timeout: 10_000 });

  assert.ok(true, "messages and a file attachment were exchanged over the WebRTC data channel");
  console.log("PASS: register/login, search, WebRTC data-channel chat, and file attachments all work end to end");
} finally {
  await browser.close();
}
