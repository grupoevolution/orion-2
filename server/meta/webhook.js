// Receptor do webhook da Meta: mensagens, status de entrega, qualidade e templates
import { one, q, getSetting } from '../db/index.js'
import { hmacSha256 } from '../lib/crypto.js'
import { upsertContact, openWindow, ensureConversation, setOwner, getContact } from '../lib/contacts.js'
import { getNumberByPhoneId, bumpDaily, syncNumber } from '../lib/numbers.js'
import { onInboundReply } from '../lib/funnel-engine.js'
import { dispatch } from '../lib/automations.js'
import { enqueue, JOBS } from '../lib/queue.js'
import { bus } from '../lib/bus.js'

export function verifySignature(rawBody, header) {
  const secret = process.env.META_APP_SECRET
  if (!secret) return true
  if (!header?.startsWith('sha256=')) return false
  const expected = hmacSha256(secret, rawBody)
  return header.slice(7) === expected
}

export async function handle(body) {
  if (body.object !== 'whatsapp_business_account') return { ignored: true }
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {}
      try {
        if (ch.field === 'messages') {
          const number = await getNumberByPhoneId(v.metadata?.phone_number_id)
          if (!number) { console.warn('[meta] número desconhecido', v.metadata?.phone_number_id); continue }
          for (const m of v.messages || []) await inbound(number, m, v.contacts || [])
          for (const s of v.statuses || []) await statusUpdate(number, s)
        } else if (ch.field === 'message_template_status_update') {
          await q(`UPDATE templates SET status=$3, rejected_reason=$4, updated_at=now() WHERE meta_id=$1 OR (waba_id=$2 AND name=$5)`,
            [String(v.message_template_id), entry.id, v.event, v.reason || null, v.message_template_name])
          bus.emit('templates', { waba_id: entry.id })
        } else if (ch.field === 'phone_number_quality_update' || ch.field === 'phone_number_name_update' || ch.field === 'account_update') {
          const n = v.display_phone_number ? await one('SELECT id FROM numbers WHERE display_phone=$1', [v.display_phone_number]) : null
          if (n) await syncNumber(n.id)
          await q('INSERT INTO events (source,type,payload) VALUES ($1,$2,$3)', ['meta', ch.field, JSON.stringify(v)])
        }
      } catch (e) { console.error('[meta webhook]', e) }
    }
  }
  return { ok: true }
}

function extract(m) {
  const t = m.type
  let body = null, mediaRef = null
  switch (t) {
    case 'text': body = m.text?.body; break
    case 'button': body = m.button?.text; break
    case 'interactive': body = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || m.interactive?.nfm_reply?.response_json; break
    case 'image': case 'video': case 'audio': case 'document': case 'sticker':
      body = m[t]?.caption || null; mediaRef = { id: m[t]?.id, mime: m[t]?.mime_type, filename: m[t]?.filename, voice: m[t]?.voice }; break
    case 'location': body = `📍 ${m.location?.name || ''} ${m.location?.latitude},${m.location?.longitude}`; break
    case 'contacts': body = '👤 ' + (m.contacts || []).map(c => c.name?.formatted_name).join(', '); break
    case 'reaction': body = m.reaction?.emoji; break
    case 'order': body = '🛒 Pedido'; break
    default: body = null
  }
  return { body, mediaRef }
}

async function inbound(number, m, profiles) {
  const exists = await one('SELECT id FROM messages WHERE wa_message_id=$1', [m.id])
  if (exists) return
  const prof = profiles.find(p => p.wa_id === m.from)
  const before = await one('SELECT id, source, owner_number_id FROM contacts WHERE phone=$1', [m.from])
  const ad = m.referral ? { id: m.referral.source_id, headline: m.referral.headline } : null
  const contact = await upsertContact({ phone: m.from, wa_id: m.from, name: prof?.profile?.name, source: before ? undefined : (ad ? 'ad' : 'inbound'), ad })
  if (!contact) return
  const { body, mediaRef } = extract(m)

  // opt-out por palavra
  const kws = (await getSetting('optout_keywords', [])) || []
  const isOptOut = m.type === 'text' && kws.some(k => String(body || '').trim().toLowerCase() === String(k).toLowerCase())

  const conv = await ensureConversation(contact.id, number.id)
  const msg = await one(`
    INSERT INTO messages (conversation_id, contact_id, number_id, direction, wa_message_id, type, body, payload, status, created_at)
    VALUES ($1,$2,$3,'in',$4,$5,$6,$7,'received', to_timestamp($8)) RETURNING *`,
    [conv.id, contact.id, number.id, m.id, m.type, body, JSON.stringify(m), Number(m.timestamp) || Date.now() / 1000])
  const preview = body || ({ image: '📷 Imagem', video: '🎬 Vídeo', audio: '🎤 Áudio', document: '📄 Documento', sticker: 'Figurinha' }[m.type] || m.type)
  await q(`UPDATE conversations SET last_message_at=now(), last_preview=$2, last_direction='in', unread=unread+1, status='open' WHERE id=$1`, [conv.id, preview])
  const adHours = ad ? Number(await getSetting('ad_window_hours', 72)) : 24
  await openWindow(contact.id, adHours)
  await setOwner(contact.id, number.id)
  await bumpDaily(number.id, 'received')
  if (mediaRef?.id) await enqueue(JOBS.MEDIA_DOWNLOAD, { messageId: msg.id, numberId: number.id, mediaId: mediaRef.id, mime: mediaRef.mime, filename: mediaRef.filename })

  if (isOptOut) {
    await q('UPDATE contacts SET opted_out=true, updated_at=now() WHERE id=$1', [contact.id])
    await q(`UPDATE funnel_runs SET status='cancelled', last_error='opt-out', ended_at=now() WHERE contact_id=$1 AND status NOT IN ('done','cancelled','failed')`, [contact.id])
  } else if (m.type !== 'reaction') {
    await onInboundReply(contact, msg)
  }
  bus.emit('message', { conversation_id: conv.id, contact_id: contact.id, number_id: number.id, message: msg })

  const fresh = await getContact(contact.id)
  if (ad) await dispatch('ad_lead', { contact: fresh, extra: { ad, variables: { anuncio: ad.headline || '' } } })
  else if (!before) await dispatch('inbound_new', { contact: fresh })
}

async function statusUpdate(number, s) {
  const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', deleted: 'deleted' }
  const st = map[s.status]
  if (!st) return
  const col = { sent: 'sent_at', delivered: 'delivered_at', read: 'read_at' }[st]
  const err = s.errors?.[0] ? `${s.errors[0].code}: ${s.errors[0].title}${s.errors[0].error_data?.details ? ' — ' + s.errors[0].error_data.details : ''}` : null
  const row = await one(`
    UPDATE messages SET status = CASE WHEN status='read' AND $2<>'failed' THEN status WHEN status='delivered' AND $2='sent' THEN status ELSE $2 END,
      ${col ? `${col} = COALESCE(${col}, to_timestamp($4)),` : ''} error = COALESCE($3, error), pricing = COALESCE($5::jsonb, pricing)
    WHERE wa_message_id=$1 RETURNING id, conversation_id, funnel_run_id, campaign_id, contact_id`,
    [s.id, st, err, Number(s.timestamp) || Date.now() / 1000, s.pricing ? JSON.stringify(s.pricing) : null])
  if (!row) return
  if (st === 'delivered') await bumpDaily(number.id, 'delivered')
  if (st === 'read') await bumpDaily(number.id, 'read')
  if (st === 'failed') {
    await bumpDaily(number.id, 'failed')
    if (row.funnel_run_id) await q(`UPDATE funnel_runs SET last_error=$2 WHERE id=$1`, [row.funnel_run_id, err])
    if (row.campaign_id) await q(`UPDATE campaign_contacts SET status='failed', error=$3 WHERE campaign_id=$1 AND contact_id=$2`, [row.campaign_id, row.contact_id, err])
  } else if (row.campaign_id && ['delivered', 'read'].includes(st)) {
    await q(`UPDATE campaign_contacts SET status = CASE WHEN status IN ('replied','converted') THEN status ELSE $3 END WHERE campaign_id=$1 AND contact_id=$2`, [row.campaign_id, row.contact_id, st])
  }
  bus.emit('status', { conversation_id: row.conversation_id, message_id: row.id, status: st, error: err })
}
