// Adaptador do webhook da Kirvano
import { one, q } from '../db/index.js'
import { upsertContact } from './contacts.js'
import { dispatch, attributeConversion } from './automations.js'
import { cancelRunsForContact } from './funnel-engine.js'

const STATUS = {
  SALE_APPROVED: 'approved', SALE_REFUNDED: 'refunded', SALE_CHARGEBACK: 'chargeback',
  SALE_CANCELED: 'canceled', SALE_EXPIRED: 'canceled', SALE_REFUSED: 'refused',
  SALE_PENDING: 'pending', SALE_WAITING_PAYMENT: 'pending', ABANDONED_CART: 'abandoned', CART_ABANDONED: 'abandoned'
}

export function parseMoney(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const s = String(v).replace(/[^\d,.-]/g, '')
  if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) return Number(s.replace(/\./g, '').replace(',', '.')) || 0
  return Number(s.replace(/,/g, '')) || 0
}

export function verifyToken(req) {
  const expected = process.env.KIRVANO_TOKEN
  if (!expected) return true
  const got = req.headers['security-token'] || req.headers['x-kirvano-token'] || req.headers['x-security-token'] || req.query.token
  return got === expected
}

export async function handle(body) {
  const event = String(body.event || body.status || '').toUpperCase()
  const status = STATUS[event] || (String(body.status || '').toUpperCase() === 'APPROVED' ? 'approved' : null)
  if (!status) return { ignored: true, reason: `evento ${event} não mapeado` }

  const c = body.customer || {}
  const contact = await upsertContact({ phone: c.phone_number || c.phone || c.mobile, name: c.name, email: c.email, document: c.document, source: 'kirvano' })
  if (!contact) return { ignored: true, reason: 'cliente sem telefone válido' }

  const products = Array.isArray(body.products) ? body.products : []
  const main = products.find(p => !p.is_order_bump) || products[0] || {}
  const saleId = body.sale_id || body.checkout_id || body.id || `${contact.id}-${Date.now()}`
  const amount = parseMoney(body.total_price ?? body.fiscal?.total_value ?? body.amount)
  const net = body.fiscal?.commission != null ? parseMoney(body.fiscal.commission) : null
  const pay = body.payment || {}
  const pixCode = pay.qrcode || pay.pix_code || pay.copy_paste || pay.pix_copy_paste || body.pix_code || null
  const link = pay.link || pay.url || body.checkout_url || body.payment_link || null
  const method = (pay.method || body.payment_method || (pixCode ? 'PIX' : null) || '').toString().toUpperCase() || null
  const utm = {}
  for (const k of Object.keys(body)) if (k.startsWith('utm_')) utm[k] = body[k]

  const prev = await one('SELECT * FROM sales WHERE gateway=$1 AND sale_id=$2', ['kirvano', String(saleId)])
  const sale = await one(`
    INSERT INTO sales (gateway, sale_id, contact_id, status, payment_method, amount, net_amount, product_name, offer_id, offer_name, products, pix_code, payment_link, utm, paid_at)
    VALUES ('kirvano',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $3='approved' THEN now() END)
    ON CONFLICT (gateway, sale_id) DO UPDATE SET status=EXCLUDED.status, payment_method=COALESCE(EXCLUDED.payment_method, sales.payment_method),
      amount = CASE WHEN EXCLUDED.amount>0 THEN EXCLUDED.amount ELSE sales.amount END, net_amount=COALESCE(EXCLUDED.net_amount, sales.net_amount),
      product_name=COALESCE(EXCLUDED.product_name, sales.product_name), offer_id=COALESCE(EXCLUDED.offer_id, sales.offer_id), offer_name=COALESCE(EXCLUDED.offer_name, sales.offer_name),
      products = CASE WHEN jsonb_array_length(EXCLUDED.products)>0 THEN EXCLUDED.products ELSE sales.products END,
      pix_code=COALESCE(EXCLUDED.pix_code, sales.pix_code), payment_link=COALESCE(EXCLUDED.payment_link, sales.payment_link),
      paid_at = COALESCE(sales.paid_at, EXCLUDED.paid_at)
    RETURNING *`,
    [String(saleId), contact.id, status, method, amount, net, main.name || null, main.offer_id ? String(main.offer_id) : null, main.offer_name || null, JSON.stringify(products), pixCode, link, JSON.stringify(utm)])

  const typeMap = { pending: 'pix_generated', approved: 'approved', refused: 'refused', abandoned: 'abandoned', refunded: 'refunded', chargeback: 'chargeback', canceled: 'canceled' }
  await q('INSERT INTO events (source,type,contact_id,sale_id,payload) VALUES ($1,$2,$3,$4,$5)', ['kirvano', typeMap[status], contact.id, sale.id, JSON.stringify({ event, amount, product: main.name, method })])

  let fired = []
  if (status === 'approved') {
    const wasPending = prev && prev.status === 'pending'
    const purchases = await one('SELECT count(*)::int c FROM sales WHERE contact_id=$1 AND status=$2 AND id<>$3', [contact.id, 'approved', sale.id])
    await q(`UPDATE contacts SET total_purchases = total_purchases + 1, total_spent = total_spent + $2, first_purchase_at=COALESCE(first_purchase_at, now()), last_purchase_at=now(), updated_at=now() WHERE id=$1`, [contact.id, amount])
    if (purchases.c > 0) await q('UPDATE sales SET is_rebuy=true WHERE id=$1', [sale.id])
    await attributeConversion(sale, contact)
    await cancelRunsForContact(contact.id, { onlyTrigger: 'pix_generated', reason: 'pix pago' })
    await cancelRunsForContact(contact.id, { onlyTrigger: 'abandoned', reason: 'comprou' })
    await cancelRunsForContact(contact.id, { onlyTrigger: 'refused', reason: 'comprou' })
    fired = await dispatch('approved', { contact, sale, extra: { wasPending, rebuy: purchases.c > 0 } })
  } else if (status === 'pending') {
    if (method && method !== 'PIX' && !pixCode) return { ok: true, sale: sale.id, note: 'pendente não-pix ignorado' }
    if (!prev || prev.status !== 'pending') fired = await dispatch('pix_generated', { contact, sale })
  } else if (status === 'refused') {
    fired = await dispatch('refused', { contact, sale })
  } else if (status === 'abandoned') {
    fired = await dispatch('abandoned', { contact, sale })
  } else if (['refunded', 'chargeback'].includes(status)) {
    await q(`UPDATE contacts SET total_purchases = GREATEST(total_purchases-1,0), total_spent = GREATEST(total_spent-$2,0) WHERE id=$1`, [contact.id, amount])
  }
  return { ok: true, sale: sale.id, contact: contact.id, status, fired }
}
