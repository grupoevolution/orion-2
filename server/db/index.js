import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { Pool } = pg
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 15 })

export const q = (text, params) => pool.query(text, params)
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null
export const all = async (text, params) => (await pool.query(text, params)).rows

export async function migrate() {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const sql = fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8')
  await pool.query(sql)
}

export async function getSetting(key, fallback = null) {
  const row = await one('SELECT value FROM settings WHERE key=$1', [key])
  return row ? row.value : fallback
}
export async function setSetting(key, value) {
  await q(`INSERT INTO settings (key,value,updated_at) VALUES ($1,$2,now())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, JSON.stringify(value)])
}

export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK'); throw e
  } finally { client.release() }
}
