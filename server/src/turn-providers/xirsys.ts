import type { TurnProvider } from './types'

export const xirsys: TurnProvider = {
  name: 'xirsys',
  isConfigured: () => !!(process.env.XIRSYS_SERVICE && process.env.XIRSYS_SECRET && process.env.XIRSYS_CHANNEL),
  async getIceServers() {
    const ident = process.env.XIRSYS_SERVICE!
    const secret = process.env.XIRSYS_SECRET!
    const channel = process.env.XIRSYS_CHANNEL!
    const auth = Buffer.from(`${ident}:${secret}`).toString('base64')

    const res = await fetch(`https://global.xirsys.net/_turn/${channel}`, {
      method: 'PUT',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'urls' }),
    })
    if (!res.ok) throw new Error(`xirsys responded ${res.status}`)

    const body = await res.json()
    if (body.s !== 'ok') throw new Error('xirsys returned non-ok status')
    return { iceServers: [body.v.iceServers], renew: 0 }
  },
}
