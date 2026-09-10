import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { migrate } from './db/index.js'
import { ensureAdmin, requireAuth } from './lib/auth.js'
import { startQueue } from './lib/queue.js'
import { startWorkers } from './jobs/workers.js'
import { router as webhooks } from './routes/webhooks.js'
import { router as api } from './routes/api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }))
app.use(compression())
app.use(cookieParser())
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8') } }))
app.use(express.urlencoded({ extended: true }))

app.use('/webhook', rateLimit({ windowMs: 60e3, max: 600 }), webhooks)
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60e3, max: 20 }))
app.use('/api', api)

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'
fs.mkdirSync(UPLOAD_DIR, { recursive: true })
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR, { maxAge: '7d' }))

const dist = path.join(__dirname, '..', 'client', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }))
  app.get('*', (req, res, next) => req.path.startsWith('/api') || req.path.startsWith('/webhook') ? next() : res.sendFile(path.join(dist, 'index.html')))
}

app.use((err, req, res, _next) => { console.error(err); res.status(500).json({ error: err.message }) })

const port = Number(process.env.PORT || 4000)
await migrate()
await ensureAdmin()
await startQueue()
await startWorkers()
app.listen(port, () => console.log(`✓ Orion 2.0 em http://localhost:${port}`))
