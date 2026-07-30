// Drives real browser sessions against a running dev server (`bun run dev`) and
// asserts the server-failover path: a message sent while the peer has never
// connected (no data channel ever opens) still gets delivered once the peer
// logs in later, and the sender learns delivery happened once they reconnect.
//
// Run: bun run test:e2e

import assert from "node:assert/strict";
import postgres from "postgres";
import { chromium } from "playwright";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SERVER_URL = process.env.E2E_SERVER_URL ?? "http://localhost:4000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://webrtc:webrtc@localhost:5432/webrtc";
const run = Date.now();
const aliceName = `alice-fo-${run}`;
const bobName = `bob-fo-${run}`;

const sql = postgres(DATABASE_URL);

async function registerUser(username) {
  await fetch(`${SERVER_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
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

async function waitForCondition(check, { timeoutMs = 5_000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitForCondition: timed out");
}

const browser = await chromium.launch();

try {
  // bob is registered via the API only — his browser never opens, so his
  // signaling WebSocket never connects and no data channel is ever possible.
  await registerUser(bobName);

  const aliceContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  await login(alice, aliceName);
  await openChatWith(alice, bobName);

  // Sending must never be gated on `connected` — bob has never been online.
  const sendDisabledEmpty = await alice.locator('button:has-text("Send")').isDisabled();
  assert.equal(sendDisabledEmpty, true, "send button should still gate on empty input");

  const message = `hello via failover ${run}`;
  await sendMessage(alice, message);
  await alice.waitForSelector(`text=${message}`, { timeout: 5_000 });

  const bubble = await alice.locator(`li:has-text("${message}")`).innerText();
  assert.ok(
    /sending|in-transit/.test(bubble),
    `status should be sending or in-transit before bob has it, got: ${bubble}`,
  );

  // The failover POST is fired async right after the optimistic local add —
  // wait for the server to actually have the row before closing alice's tab,
  // otherwise closing the context aborts the in-flight request.
  await waitForCondition(async () => {
    const rows = await sql`SELECT id FROM messages WHERE text = ${message}`;
    return rows.length > 0;
  });

  // Alice goes "offline" (closes her tab) before bob ever sees the message —
  // the row must sit durably in the server's failover store either way.
  // context.close() resolving doesn't guarantee the server has processed the
  // WebSocket's close event yet, so give it a moment before bob's ack fires
  // (below) — otherwise bob's ack can race a socket that's OPEN client-side-
  // torn-down but not yet removed from the server's `peers` map, and the live
  // push gets sent into a socket nothing is listening on anymore.
  await aliceContext.close();
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Bob logs in after the message was sent and alice is gone — he only
  // catches up via the one-shot GET fetch on chat-page mount, never a poll.
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await login(bob, bobName);
  await openChatWith(bob, aliceName);
  await bob.waitForSelector(`text=${message}`, { timeout: 10_000 });

  // Seeing the row locally and acking it (POST /messages/:id/ack) are two
  // separate async steps on bob's side — wait for the ack to actually land
  // before closing his tab.
  await waitForCondition(async () => {
    const rows = await sql`SELECT recipient_acked_at FROM messages WHERE text = ${message}`;
    return rows.length === 1 && rows[0].recipient_acked_at !== null;
  });
  await bobContext.close();

  // Alice reconnects later — the queued `message-acked` push must flush the
  // instant her WebSocket reopens, completing the two-sided ack. Zustand state
  // isn't persisted (accepted limitation, see checklist.md), so a fresh session
  // can't show the old bubble flip to "sent" — the durable guarantee this phase
  // makes is server-side: the row gets deleted once the sender's ack completes.
  const aliceContext2 = await browser.newContext();
  const alice2 = await aliceContext2.newPage();
  await login(alice2, aliceName);
  await openChatWith(alice2, bobName);
  await waitForCondition(async () => {
    const rows = await sql`SELECT id FROM messages WHERE text = ${message}`;
    return rows.length === 0;
  }, { timeoutMs: 10_000 });
  await aliceContext2.close();

  console.log("PASS: failover send/receive works with the peer never connected, and delivery is confirmed on reconnect");
} finally {
  await sql.end();
  await browser.close();
}
