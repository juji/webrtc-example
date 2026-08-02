export type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string }

// renew: epoch ms when the caller should re-fetch credentials, or 0 if the
// provider has no known expiry (caller decides its own refresh policy).
export type TurnCredentials = { iceServers: RTCIceServerLike[]; renew: number }

export type TurnProvider = {
  name: string
  isConfigured: () => boolean
  getIceServers: () => Promise<TurnCredentials>
}
