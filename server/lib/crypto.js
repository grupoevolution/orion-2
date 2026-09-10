import crypto from 'node:crypto'

function key() {
  const k = process.env.APP_KEY || ''
  if (k.length < 32) throw new Error('APP_KEY precisa ter pelo menos 32 caracteres')
  return crypto.createHash('sha256').update(k).digest()
}

export function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), data = buf.subarray(28)
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(data), d.final()]).toString('utf8')
}

export function mask(token) {
  if (!token) return ''
  return token.slice(0, 6) + '…' + token.slice(-4)
}

export function hmacSha256(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}
