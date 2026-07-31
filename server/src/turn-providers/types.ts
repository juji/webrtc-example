export type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string }

export type TurnProvider = {
  name: string
  isConfigured: () => boolean
  getIceServers: () => Promise<RTCIceServerLike[]>
}
