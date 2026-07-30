import { Hono } from 'hono'

export const turn = new Hono()

turn.get('/credentials', async (c) => {
  const appName = process.env.METERED_APP_NAME
  const apiKey = process.env.METERED_API_KEY

  if (!appName || !apiKey) {
    return c.json({ error: 'TURN credentials are not configured' }, 500)
  }

  const res = await fetch(`https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`)

  if (!res.ok) {
    return c.json({ error: 'failed to fetch TURN credentials' }, 502)
  }

  const iceServers = await res.json()

  return c.json({ iceServers })
})
