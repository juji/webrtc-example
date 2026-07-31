import { Hono } from 'hono'
import { cfSpeed } from '../turn-providers/cf-speed'
import { coturn } from '../turn-providers/coturn'
import { expressTurn } from '../turn-providers/express-turn'
import { metered } from '../turn-providers/metered'
import { twilio } from '../turn-providers/twilio'
import type { TurnProvider } from '../turn-providers/types'
import { xirsys } from '../turn-providers/xirsys'

export const turn = new Hono()

const providers: TurnProvider[] = [coturn, cfSpeed, metered, twilio, xirsys, expressTurn]

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
