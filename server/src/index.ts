import { CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand } from '@aws-sdk/client-s3'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './routes/auth'
import { messagesRoute } from './routes/messages'
import { turn } from './routes/turn'
import { usersRoute } from './routes/users'
import { signaling, websocket } from './signaling'
import { BUCKET, s3 } from './storage'

const app = new Hono()

app.use('*', cors())

app.route('/auth', auth)
app.route('/users', usersRoute)
app.route('/turn', turn)
app.route('/signaling', signaling)
app.route('/messages', messagesRoute)

async function ensureAttachmentsBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  }

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: BUCKET,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${BUCKET}/*`,
          },
        ],
      }),
    }),
  )
}

try {
  await ensureAttachmentsBucket()
} catch (err) {
  console.error('RustFS unreachable at startup, attachment endpoints will fail until it recovers:', err)
}

export default {
  port: 4000,
  fetch: app.fetch,
  websocket,
}
