import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { one, q } from '../db/index.js'

const COOKIE = 'orion_session'

export async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD
  if (!email || !pass) return
  const exists = await one('SELECT id FROM admins WHERE email=$1', [email.toLowerCase()])
  if (!exists) {
    await q('INSERT INTO admins (email,password_hash,name) VALUES ($1,$2,$3)', [email.toLowerCase(), await bcrypt.hash(pass, 10), 'Admin'])
    console.log('✓ admin criado:', email)
  }
}

export async function login(email, password) {
  const a = await one('SELECT * FROM admins WHERE email=$1', [String(email || '').toLowerCase()])
  if (!a || !(await bcrypt.compare(password || '', a.password_hash))) return null
  await q('UPDATE admins SET last_login_at=now() WHERE id=$1', [a.id])
  return a
}

export function sign(admin) {
  return jwt.sign({ id: admin.id, email: admin.email }, process.env.JWT_SECRET, { expiresIn: '30d' })
}

export function setCookie(res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 86400e3 })
}
export function clearCookie(res) { res.clearCookie(COOKIE) }

export function requireAuth(req, res, next) {
  const t = req.cookies?.[COOKIE] || (req.headers.authorization || '').replace(/^Bearer /, '')
  try { req.admin = jwt.verify(t, process.env.JWT_SECRET); next() }
  catch { res.status(401).json({ error: 'não autenticado' }) }
}

export async function changePassword(adminId, newPassword) {
  await q('UPDATE admins SET password_hash=$2 WHERE id=$1', [adminId, await bcrypt.hash(newPassword, 10)])
}
