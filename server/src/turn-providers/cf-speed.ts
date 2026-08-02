import type { TurnProvider } from './types'

// Cloudflare's turn-creds response carries no expiry — it's an undocumented
// endpoint built for their own speed test, not a real public API contract.
// 1 hour is the default assumed TTL, since the real value can't be
// confirmed from the response; override via CF_SPEED_RENEW_SECONDS if needed.
const DEFAULT_RENEW_SECONDS = 60 * 60

export const cfSpeed: TurnProvider = {
  name: 'cfSpeed',
  isConfigured: () => !!process.env.CF_SPEED_SERVICE,
  async getIceServers() {
    const res = await fetch('https://speed.cloudflare.com/turn-creds', {
      headers: { Origin: 'https://speed.cloudflare.com' },
    })
    if (!res.ok) throw new Error(`cf-speed responded ${res.status}`)
    const { urls, username, credential } = await res.json()
    const renewSeconds = Number(process.env.CF_SPEED_RENEW_SECONDS) || DEFAULT_RENEW_SECONDS
    return { iceServers: [{ urls, username, credential }], renew: Date.now() + renewSeconds * 1000 }
  },
}
