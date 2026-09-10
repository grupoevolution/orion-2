// Cadastro, saúde e roteamento dos números
import { all, one, q } from '../db/index.js'
import { encrypt, decrypt } from './crypto.js'
import * as meta from '../meta/client.js'

export const listNumbers = () => all('SELECT * FROM numbers ORDER BY is_default DESC, id')
export const getNumber = id => one('SELECT * FROM numbers WHERE id=$1', [id])
export const getNumberByPhoneId = pid => one('SELECT * FROM numbers WHERE phone_number_id=$1', [pid])

export function publicNumber(n) {
  if (!n) return n
  const { token_enc, ...rest } = n
  return { ...rest, has_token: !!token_enc, daily_limit: n.daily_cap || meta.tierLimit(n.messaging_limit) }
}

export async function addNumber({ label, phone_number_id, waba_id, token }) {
  const info = await meta.getPhoneInfo(token, phone_number_id)   // valida token e número
  const row = await one(`
    INSERT INTO numbers (label, phone_number_id, waba_id, display_phone, verified_name, token_enc, quality_rating, messaging_limit, meta, synced_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
    ON CONFLICT (phone_number_id) DO UPDATE SET label=EXCLUDED.label, waba_id=EXCLUDED.waba_id, token_enc=EXCLUDED.token_enc,
      display_phone=EXCLUDED.display_phone, verified_name=EXCLUDED.verified_name, quality_rating=EXCLUDED.quality_rating,
      messaging_limit=EXCLUDED.messaging_limit, meta=EXCLUDED.meta, synced_at=now(), status='active', last_error=NULL
    RETURNING *`,
    [label || info.verified_name || info.display_phone_number, phone_number_id, waba_id, info.display_phone_number, info.verified_name,
      encrypt(token), info.quality_rating || 'UNKNOWN', info.messaging_limit_tier || 'TIER_250', JSON.stringify(info)])
  try { await meta.subscribeApp(token, waba_id) } catch (e) { console.warn('[numbers] subscribe_apps:', e.message) }
  const count = await one('SELECT count(*)::int c FROM numbers')
  if (count.c === 1) await q('UPDATE numbers SET is_default=true WHERE id=$1', [row.id])
  return row
}

export async function syncNumber(id) {
  const n = await getNumber(id)
  if (!n) return null
  try {
    const info = await meta.getPhoneInfo(decrypt(n.token_enc), n.phone_number_id)
    const prevQ = n.quality_rating
    await q(`UPDATE numbers SET display_phone=$2, verified_name=$3, quality_rating=$4, messaging_limit=$5, meta=$6, synced_at=now(), last_error=NULL,
             status = CASE WHEN status='error' THEN 'active' ELSE status END WHERE id=$1`,
      [id, info.display_phone_number, info.verified_name, info.quality_rating || 'UNKNOWN', info.messaging_limit_tier || n.messaging_limit, JSON.stringify(info)])
    if (prevQ !== info.quality_rating) await q('INSERT INTO events (source,type,payload) VALUES ($1,$2,$3)', ['meta', 'quality_change', JSON.stringify({ number_id: id, from: prevQ, to: info.quality_rating })])
    return getNumber(id)
  } catch (e) {
    await q(`UPDATE numbers SET status='error', last_error=$2, synced_at=now() WHERE id=$1`, [id, e.message])
    return getNumber(id)
  }
}

export async function usageToday(numberId) {
  const r = await one(`SELECT sent, template_sent FROM number_daily WHERE number_id=$1 AND day = (now() AT TIME ZONE 'America/Sao_Paulo')::date`, [numberId])
  return r || { sent: 0, template_sent: 0 }
}

export async function bumpDaily(numberId, field, by = 1) {
  await q(`INSERT INTO number_daily (number_id, day, ${field}) VALUES ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date, $2)
           ON CONFLICT (number_id, day) DO UPDATE SET ${field} = number_daily.${field} + $2`, [numberId, by])
}

// Números saudáveis com folga no limite diário (para envio de template)
export async function healthyNumbers({ excludeIds = [] } = {}) {
  const rows = await all(`
    SELECT n.*, COALESCE(d.template_sent,0) AS used_today
    FROM numbers n
    LEFT JOIN number_daily d ON d.number_id=n.id AND d.day=(now() AT TIME ZONE 'America/Sao_Paulo')::date
    WHERE n.status='active' AND n.quality_rating <> 'RED'`)
  return rows
    .filter(n => !excludeIds.includes(n.id))
    .map(n => ({ ...n, limit: n.daily_cap || meta.tierLimit(n.messaging_limit), remaining: (n.daily_cap || meta.tierLimit(n.messaging_limit)) - n.used_today }))
    .filter(n => n.remaining > 0)
}

// Regra: lead fica com o número que já falou com ele; senão, o número saudável com menos uso proporcional (ponderado por weight)
export async function pickNumber(contact, { allowed = null } = {}) {
  if (contact?.owner_number_id) {
    const owner = await getNumber(contact.owner_number_id)
    if (owner && owner.status === 'active' && owner.quality_rating !== 'RED' && (!allowed || allowed.includes(owner.id))) {
      const u = await usageToday(owner.id)
      if (u.template_sent < (owner.daily_cap || meta.tierLimit(owner.messaging_limit))) return owner
    }
  }
  let pool = await healthyNumbers()
  if (allowed) pool = pool.filter(n => allowed.includes(n.id))
  if (!pool.length) return null
  pool.sort((a, b) => (a.used_today / (a.limit * (a.weight || 1))) - (b.used_today / (b.limit * (b.weight || 1))))
  return pool[0]
}
