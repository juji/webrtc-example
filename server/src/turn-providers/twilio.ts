import Twilio from 'twilio'
import type { RTCIceServerLike, TurnProvider } from './types'

export const twilio: TurnProvider = {
  name: 'twilio',
  isConfigured: () => !!(process.env.TWILIO_SERVICE && process.env.TWILIO_AUTH_TOKEN),
  async getIceServers() {
    const client = Twilio(process.env.TWILIO_SERVICE!, process.env.TWILIO_AUTH_TOKEN!)
    const token = await client.tokens.create()
    const iceServers = (token.iceServers ?? []).map(({ urls, username, credential }) => ({
      urls: urls!,
      username,
      credential,
    })) satisfies RTCIceServerLike[]
    return { iceServers, renew: Date.now() + Number(token.ttl) * 1000 }
  },
}
