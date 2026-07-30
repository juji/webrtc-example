import { Hono } from 'hono'
import { createBunWebSocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'

// The raw Bun socket underneath WSContext.raw — only readyState is needed here.
type RawSocket = { readyState: 0 | 1 | 2 | 3 }

const { upgradeWebSocket, websocket } = createBunWebSocket()
export { websocket }

// username -> open socket. In-memory only: fine for a single-process learning example.
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
// username -> messages waiting for that user to connect (e.g. an offer sent before they open the chat).
const pending = new Map<string, string[]>()

export const signaling = new Hono()

// Sends now if the target is connected, otherwise queues for the same onOpen flush
// used for offers sent to a not-yet-connected peer.
export function notifyUser(username: string, payload: unknown) {
  const target = peers.get(username)
  const message = JSON.stringify(payload)

  if (target && (target.raw as RawSocket | undefined)?.readyState === 1 /* OPEN */) {
    try {
      target.send(message)
      return
    } catch {
      // fall through to queue
    }
  }

  const queue = pending.get(username) ?? []
  queue.push(message)
  pending.set(username, queue)
}

signaling.get(
  '/',
  upgradeWebSocket((c) => {
    const username = c.req.query('username')

    return {
      onOpen(_event, ws) {
        if (!username) {
          ws.close(1008, 'username query param is required')
          return
        }

        // A stale connection for this username (e.g. a tab that hasn't finished closing yet)
        // must not keep receiving messages meant for the new one.
        const existing = peers.get(username)
        if (existing && existing.raw !== ws.raw) existing.close()

        peers.set(username, ws)

        const queued = pending.get(username)
        if (queued) {
          pending.delete(username)
          for (const message of queued) ws.send(message)
        }
      },
      onMessage(event, ws) {
        if (!username) return

        const message = JSON.parse(event.data.toString()) as { to: string; [key: string]: unknown }
        notifyUser(message.to, { ...message, from: username })
      },
      onClose(_event, ws) {
        if (username && peers.get(username)?.raw === ws.raw) peers.delete(username)
      },
    }
  }),
)
