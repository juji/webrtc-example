import { Hono } from 'hono'
import { createBunWebSocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'

const { upgradeWebSocket, websocket } = createBunWebSocket()
export { websocket }

// username -> open socket. In-memory only: fine for a single-process learning example.
const peers = new Map<string, WSContext>()
// username -> messages waiting for that user to connect (e.g. an offer sent before they open the chat).
const pending = new Map<string, string[]>()

export const signaling = new Hono()

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
        if (existing && existing !== ws) existing.close()

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
        const payload = JSON.stringify({ ...message, from: username })

        const target = peers.get(message.to)
        if (target && target.readyState === 1 /* OPEN */) {
          target.send(payload)
        } else {
          const queue = pending.get(message.to) ?? []
          queue.push(payload)
          pending.set(message.to, queue)
        }
      },
      onClose(_event, ws) {
        if (username && peers.get(username) === ws) peers.delete(username)
      },
    }
  }),
)
