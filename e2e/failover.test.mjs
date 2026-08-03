// Drives real browser sessions against a running dev server (`bun run dev`) and
// asserts the server-failover path: a message sent while the peer is fully
// offline (tab closed, no data channel possible) still gets delivered once
// the peer logs in later, and the sender learns delivery happened once they
// reconnect.
//
// Run: bun run test:e2e

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { chromium } from "playwright";
import { becomeContacts, getMyContactInfo, login, newUser, openChatWith, sendMessage } from "./helpers.mjs";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://webrtc:webrtc@localhost:5432/webrtc";
const run = Date.now();
const aliceName = `alice-fo-${run}`;
const bobName = `bob-fo-${run}`;
const qrDir = mkdtempSync(path.join(tmpdir(), "webrtc-e2e-fo-qr-"));

const sql = postgres(DATABASE_URL);

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
  const alice = await newUser(browser);
  await login(alice.page, aliceName);

  // Bob has to accept alice's contact request from his own session before
  // her UI will let her message him at all — but once that handshake is
  // done, he goes fully offline (tab closed) before alice sends anything,
  // preserving the scenario: bob's signaling WebSocket is never open and no
  // data channel is ever possible when the message is sent. His local keys
  // (client/lib/keys.ts) live in this context's OPFS, so every later
  // "bob logs in again" reuses bob.context (a new page, not a new context)
  // — a fresh context would have no local key and login() would throw.
  const bob = await newUser(browser);
  await login(bob.page, bobName);
  const bobInfo = await getMyContactInfo(bob.page);
  await becomeContacts(qrDir, alice.page, aliceName, bob.page, bobInfo);
  await bob.page.close();

  await openChatWith(alice.page, bobName);

  // Sending must never be gated on `connected` — bob is offline.
  const sendDisabledEmpty = await alice.page.locator('button[aria-label="Send message"]').isDisabled();
  assert.equal(sendDisabledEmpty, true, "send button should still gate on empty input");

  const message = `hello via failover ${run}`;
  await sendMessage(alice.page, message);
  await alice.page.waitForSelector(`text=${message}`, { timeout: 5_000 });

  // "sent" here only means the failover POST reached the server — bob hasn't
  // acked it yet in any of these three states, and dispatchTextViaServer
  // (use-webrtc-chat.ts) flips in-transit -> sent as soon as that POST
  // resolves, which on local Postgres can beat this read by milliseconds.
  const bubble = await alice.page.locator(`div:has(> span:text-is("${message}"))`).innerText();
  assert.ok(
    /sending|in-transit|sent/.test(bubble),
    `status should be sending, in-transit, or sent before bob has acked it, got: ${bubble}`,
  );

  // The failover POST is fired async right after the optimistic local add —
  // wait for the server to actually have the row before closing alice's tab,
  // otherwise closing the context aborts the in-flight request.
  await waitForCondition(async () => {
    const rows = await sql`SELECT id FROM messages WHERE text = ${message}`;
    return rows.length > 0;
  });

  // Alice goes offline (closes her tab) before bob ever sees the message —
  // the row must sit durably in the server's failover store either way. Her
  // context (and its local keys) stays alive for the later reconnect below —
  // only the page/tab closes, same as bob's.
  // page.close() resolving doesn't guarantee the server has processed the
  // WebSocket's close event yet, so give it a moment before bob's ack fires
  // (below) — otherwise bob's ack can race a socket that's OPEN client-side-
  // torn-down but not yet removed from the server's `peers` map, and the live
  // push gets sent into a socket nothing is listening on anymore.
  await alice.page.close();
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Bob logs in again after the message was sent and alice is gone — he only
  // catches up via the one-shot GET fetch on chat-page mount, never a poll.
  // Same context as before (his local keys live there), fresh page.
  const bob2 = await bob.context.newPage();
  await login(bob2, bobName);
  await openChatWith(bob2, aliceName);
  await bob2.waitForSelector(`text=${message}`, { timeout: 10_000 });

  // Seeing the row locally and acking it (POST /messages/:id/ack) are two
  // separate async steps on bob's side — wait for the ack to actually land
  // before closing his tab.
  await waitForCondition(async () => {
    const rows = await sql`SELECT recipient_acked_at FROM messages WHERE text = ${message}`;
    return rows.length === 1 && rows[0].recipient_acked_at !== null;
  });
  await bob.context.close();

  // Alice reconnects later — the queued `message-acked` push must flush the
  // instant her WebSocket reopens, completing the two-sided ack. Zustand state
  // isn't persisted (accepted limitation, see checklist.md), so a fresh session
  // can't show the old bubble flip to "sent" — the durable guarantee this phase
  // makes is server-side: the row gets deleted once the sender's ack completes.
  const alice2 = await alice.context.newPage();
  await login(alice2, aliceName);
  await openChatWith(alice2, bobName);
  await waitForCondition(async () => {
    const rows = await sql`SELECT id FROM messages WHERE text = ${message}`;
    return rows.length === 0;
  }, { timeoutMs: 10_000 });

  console.log("PASS: failover send/receive works with the peer never connected, and delivery is confirmed on reconnect");
} finally {
  await sql.end();
  await browser.close();
}
