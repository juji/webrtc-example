import { Hono } from 'hono'
import { createBunWebSocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'

// The raw Bun socket underneath WSContext.raw — only readyState is needed here.
type RawSocket = { readyState: 0 | 1 | 2 | 3 }

const { upgradeWebSocket, websocket } = createBunWebSocket()
export { websocket }

// userId -> open socket. In-memory only: fine for a single-process learning example.
//
// Hono's Bun adapter constructs a brand-new WSContext wrapper on every single
// event (open/message/close) for the same underlying connection, and that
// wrapper's `readyState` is a snapshot taken at construction time, not a live
// read of the socket. Comparing/reading via the wrapper (`===`, `.readyState`)
// is therefore unreliable across events: `onClose`'s identity check against a
// wrapper stored during `onOpen` never matches, so a closed connection was
// never actually removed from `peers`, and `.readyState` on a stored wrapper
// stayed frozen at "open" forever. `.raw` is the actual Bun ServerWebSocket,
// stable across events — key/compare/read state off that instead.
const peers = new Map<string, WSContext>()
// userId -> messages waiting for that user to connect (e.g. an offer sent before they open the chat).
const pending = new Map<string, string[]>()

export const signaling = new Hono()

// Sends now if the target is connected, otherwise queues for the same onOpen flush
// used for offers sent to a not-yet-connected peer. Keyed by userId, not username —
// usernames are only ever chosen by the user and shown in the UI, not a stable
// routable identity the server should key connection state on.
export function notifyUser(userId: string, payload: unknown) {
  const target = peers.get(userId)
  const message = JSON.stringify(payload)

  if (target && (target.raw as RawSocket | undefined)?.readyState === 1 /* OPEN */) {
    try {
      target.send(message)
      return
    } catch {
      // fall through to queue
    }
  }

  const queue = pending.get(userId) ?? []
  queue.push(message)
  pending.set(userId, queue)
}

signaling.get(
  '/',
  upgradeWebSocket((c) => {
    const userId = c.req.query('userId')

    return {
      onOpen(_event, ws) {
        if (!userId) {
          ws.close(1008, 'userId query param is required')
          return
        }

        // A stale connection for this user (e.g. a tab that hasn't finished closing yet)
        // must not keep receiving messages meant for the new one.
        const existing = peers.get(userId)
        if (existing && existing.raw !== ws.raw) existing.close()

        peers.set(userId, ws)

        const queued = pending.get(userId)
        if (queued) {
          pending.delete(userId)
          for (const message of queued) ws.send(message)
        }
      },
      onMessage(event, ws) {
        if (!userId) return

        const message = JSON.parse(event.data.toString()) as { to: string; [key: string]: unknown }
        notifyUser(message.to, { ...message, from: userId })
      },
      onClose(_event, ws) {
        if (userId && peers.get(userId)?.raw === ws.raw) peers.delete(userId)
      },
    }
  }),
)
