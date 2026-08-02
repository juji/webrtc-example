import type { TurnProvider } from './types'

export const metered: TurnProvider = {
  name: 'metered',
  isConfigured: () => !!(process.env.METERED_SERVICE && process.env.METERED_API_KEY),
  async getIceServers() {
    const appName = process.env.METERED_SERVICE!
    const apiKey = process.env.METERED_API_KEY!
    const res = await fetch(`https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`)
    if (!res.ok) throw new Error(`metered responded ${res.status}`)
    return { iceServers: await res.json(), renew: 0 }
  },
}
