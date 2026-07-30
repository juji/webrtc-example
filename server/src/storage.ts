import { S3Client } from '@aws-sdk/client-s3'

export const BUCKET = 'attachments'

export const s3 = new S3Client({
  endpoint: process.env.RUSTFS_ENDPOINT ?? 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.RUSTFS_ACCESS_KEY ?? 'webrtc',
    secretAccessKey: process.env.RUSTFS_SECRET_KEY ?? 'webrtcsecret',
  },
  forcePathStyle: true,
})
