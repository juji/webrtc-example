import { createHmac } from 'node:crypto'
import type { TurnProvider } from './types'

const TTL_SECONDS = 3600

export const coturn: TurnProvider = {
  name: 'coturn',
  isConfigured: () => !!(process.env.COTURN_SERVICE && process.env.COTURN_SECRET),
  async getIceServers() {
    const host = process.env.COTURN_SERVICE!
    const secret = process.env.COTURN_SECRET!
    const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS
    const username = `${expiry}:webrtc`
    const credential = createHmac('sha1', secret).update(username).digest('base64')
    return { iceServers: [{ urls: `turn:${host}`, username, credential }], renew: expiry * 1000 }
  },
}
