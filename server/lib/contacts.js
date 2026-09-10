import { one, q } from '../db/index.js'
import { normalizePhone } from './phone.js'

export async function upsertContact({ phone, name, email, document, source, wa_id, ad }) {
  const p = normalizePhone(phone)
  if (!p) return null
  const row = await one(`
    INSERT INTO contacts (phone, name, email, document, source, wa_id, ad_id, ad_headline)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (phone) DO UPDATE SET
      name = COALESCE(NULLIF(EXCLUDED.name,''), contacts.name),
      email = COALESCE(NULLIF(EXCLUDED.email,''), contacts.email),
      document = COALESCE(NULLIF(EXCLUDED.document,''), contacts.document),
      wa_id = COALESCE(EXCLUDED.wa_id, contacts.wa_id),
      ad_id = COALESCE(EXCLUDED.ad_id, contacts.ad_id),
      ad_headline = COALESCE(EXCLUDED.ad_headline, contacts.ad_headline),
      updated_at = now()
    RETURNING *`,
    [p, name || null, email ? email.toLowerCase() : null, document || null, source || 'unknown', wa_id || null, ad?.id || null, ad?.headline || null])
  return row
}

export const getContact = id => one('SELECT * FROM contacts WHERE id=$1', [id])
export const getContactByPhone = phone => one('SELECT * FROM contacts WHERE phone=$1', [normalizePhone(phone)])

export async function addTag(contactId, tag) {
  await q(`UPDATE contacts SET tags = array_append(array_remove(tags,$2),$2), updated_at=now() WHERE id=$1`, [contactId, tag])
}
export async function removeTag(contactId, tag) {
  await q(`UPDATE contacts SET tags = array_remove(tags,$2), updated_at=now() WHERE id=$1`, [contactId, tag])
}
export async function setVariable(contactId, key, value) {
  await q(`UPDATE contacts SET variables = variables || $2::jsonb, updated_at=now() WHERE id=$1`, [contactId, JSON.stringify({ [key]: value })])
}
export async function setOwner(contactId, numberId) {
  await q('UPDATE contacts SET owner_number_id=COALESCE(owner_number_id,$2), updated_at=now() WHERE id=$1', [contactId, numberId])
}

// Abre/renova a janela de atendimento quando o cliente manda mensagem
export async function openWindow(contactId, hours = 24) {
  await q(`UPDATE contacts SET last_inbound_at=now(), window_expires_at = now() + ($2 || ' hours')::interval, updated_at=now() WHERE id=$1`, [contactId, String(hours)])
}

export async function ensureConversation(contactId, numberId) {
  return one(`INSERT INTO conversations (contact_id, number_id) VALUES ($1,$2)
              ON CONFLICT (contact_id, number_id) DO UPDATE SET status='open' RETURNING *`, [contactId, numberId])
}
