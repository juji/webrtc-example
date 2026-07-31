import type { TurnProvider } from './types'

export const expressTurn: TurnProvider = {
  name: 'expressTurn',
  isConfigured: () =>
    !!(process.env.EXPRESSTURN_SERVICE && process.env.EXPRESSTURN_USERNAME && process.env.EXPRESSTURN_PASSWORD),
  async getIceServers() {
    return [
      {
        urls: `turn:${process.env.EXPRESSTURN_SERVICE}`,
        username: process.env.EXPRESSTURN_USERNAME!,
        credential: process.env.EXPRESSTURN_PASSWORD!,
      },
    ]
  },
}
