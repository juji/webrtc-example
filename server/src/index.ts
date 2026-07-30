import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './routes/auth'
import { turn } from './routes/turn'
import { usersRoute } from './routes/users'
import { signaling, websocket } from './signaling'

const app = new Hono()

app.use('*', cors())

app.route('/auth', auth)
app.route('/users', usersRoute)
app.route('/turn', turn)
app.route('/signaling', signaling)

export default {
  port: 4000,
  fetch: app.fetch,
  websocket,
}
