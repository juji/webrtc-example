import type { TurnProvider } from './types'

export const cfSpeed: TurnProvider = {
  name: 'cfSpeed',
  isConfigured: () => !!process.env.CF_SPEED_SERVICE,
  async getIceServers() {
    const res = await fetch('https://speed.cloudflare.com/turn-creds', {
      headers: { Origin: 'https://speed.cloudflare.com' },
    })
    if (!res.ok) throw new Error(`cf-speed responded ${res.status}`)
    const { urls, username, credential } = await res.json()
    return [{ urls, username, credential }]
  },
}
