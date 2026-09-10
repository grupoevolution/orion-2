// Templates: sincronização com a Meta e criação pelo painel
import { all, one, q } from '../db/index.js'
import * as meta from '../meta/client.js'
import { decrypt } from './crypto.js'

export async function syncTemplates(number) {
  const token = decrypt(number.token_enc)
  const list = await meta.listTemplates(token, number.waba_id)
  for (const t of list) {
    await q(`
      INSERT INTO templates (waba_id, meta_id, name, language, category, status, components, rejected_reason, quality, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
      ON CONFLICT (waba_id, name, language) DO UPDATE SET meta_id=EXCLUDED.meta_id, category=EXCLUDED.category, status=EXCLUDED.status,
        components=EXCLUDED.components, rejected_reason=EXCLUDED.rejected_reason, quality=EXCLUDED.quality, synced_at=now(), updated_at=now()`,
      [number.waba_id, String(t.id), t.name, t.language, t.category, t.status, JSON.stringify(t.components || []), t.rejected_reason || null, t.quality_score?.score || null])
  }
  return list.length
}

// Monta os components no formato da Meta a partir de um formulário simples do painel
export function buildComponents({ header, body, footer, buttons = [], bodyExamples = [] }) {
  const comps = []
  if (header?.type === 'TEXT' && header.text) comps.push({ type: 'HEADER', format: 'TEXT', text: header.text, ...(header.example ? { example: { header_text: [header.example] } } : {}) })
  else if (header?.type && header.type !== 'TEXT' && header.handle) comps.push({ type: 'HEADER', format: header.type, example: { header_handle: [header.handle] } })
  const nVars = (body.match(/\{\{\d+\}\}/g) || []).length
  comps.push({ type: 'BODY', text: body, ...(nVars ? { example: { body_text: [Array.from({ length: nVars }, (_, i) => bodyExamples[i] || `exemplo ${i + 1}`)] } } : {}) })
  if (footer) comps.push({ type: 'FOOTER', text: footer })
  if (buttons.length) comps.push({ type: 'BUTTONS', buttons: buttons.map(b => b.type === 'URL' ? { type: 'URL', text: b.text, url: b.url, ...(b.example ? { example: [b.example] } : {}) } : b.type === 'PHONE_NUMBER' ? { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone } : b.type === 'COPY_CODE' ? { type: 'COPY_CODE', example: b.example || 'CODIGO' } : { type: 'QUICK_REPLY', text: b.text }) })
  return comps
}

export async function createTemplate(number, { name, language = 'pt_BR', category = 'UTILITY', components, variables = [] }) {
  const token = decrypt(number.token_enc)
  const safe = String(name).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 512)
  const r = await meta.createTemplate(token, number.waba_id, { name: safe, language, category, components })
  return one(`
    INSERT INTO templates (waba_id, meta_id, name, language, category, status, components, variables, synced_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
    ON CONFLICT (waba_id, name, language) DO UPDATE SET meta_id=EXCLUDED.meta_id, category=EXCLUDED.category, status=EXCLUDED.status, components=EXCLUDED.components, variables=EXCLUDED.variables, updated_at=now()
    RETURNING *`, [number.waba_id, String(r.id), safe, language, r.category || category, r.status || 'PENDING', JSON.stringify(components), JSON.stringify(variables)])
}

export async function deleteTemplate(number, template) {
  const token = decrypt(number.token_enc)
  await meta.deleteTemplate(token, number.waba_id, template.name)
  await q('DELETE FROM templates WHERE id=$1', [template.id])
}

export const listLocal = (wabaId = null) => wabaId ? all('SELECT * FROM templates WHERE waba_id=$1 ORDER BY status, name', [wabaId]) : all('SELECT * FROM templates ORDER BY status, name')
