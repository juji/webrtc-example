import { Hono } from 'hono'
import { cfSpeed } from '../turn-providers/cf-speed'
import { coturn } from '../turn-providers/coturn'
import { metered } from '../turn-providers/metered'
import type { TurnProvider } from '../turn-providers/types'

export const turn = new Hono()

const providers: TurnProvider[] = [coturn, cfSpeed, metered]

turn.get('/credentials', async (c) => {
  const provider = providers.find((p) => p.isConfigured())
  if (!provider) return c.json({ error: 'TURN credentials are not configured' }, 500)

  try {
    const iceServers = await provider.getIceServers()
    return c.json({ iceServers })
  } catch {
    return c.json({ error: `${provider.name} TURN request failed` }, 502)
  }
})
