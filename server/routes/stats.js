// Dashboard: métricas de envio, funil de Pix e conversão
import { Router } from 'express'
import { all, one, getSetting } from '../db/index.js'

export const statsRouter = Router()
const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(400).json({ error: e.message }))

function range(req) {
  const days = Math.min(Number(req.query.days || 7), 90)
  return { days, from: `now() - interval '${days} days'`, prevFrom: `now() - interval '${days * 2} days'` }
}

statsRouter.get('/overview', wrap(async (req, res) => {
  const { days, from, prevFrom } = range(req)
  const delay = Number(await getSetting('pix_delay_minutes', 7))
  const cur = await one(`
    SELECT
      (SELECT count(*)::int FROM events WHERE source='kirvano' AND created_at > ${from}) AS events,
      (SELECT count(*)::int FROM messages WHERE direction='out' AND created_at > ${from}) AS sent,
      (SELECT count(*)::int FROM messages WHERE direction='out' AND status IN ('delivered','read') AND created_at > ${from}) AS delivered,
      (SELECT count(*)::int FROM messages WHERE direction='out' AND status='read' AND created_at > ${from}) AS read,
      (SELECT count(*)::int FROM messages WHERE direction='out' AND status='failed' AND created_at > ${from}) AS failed,
      (SELECT count(*)::int FROM messages WHERE direction='in' AND created_at > ${from}) AS received,
      (SELECT count(*)::int FROM funnel_runs WHERE started_at > ${from}) AS runs,
      (SELECT count(*)::int FROM funnel_runs WHERE started_at > ${from} AND replied) AS runs_replied,
      (SELECT count(*)::int FROM funnel_runs WHERE started_at > ${from} AND converted) AS runs_converted,
      (SELECT coalesce(sum(s.amount),0)::float FROM sales s JOIN funnel_runs r ON r.id=s.attributed_run_id WHERE s.paid_at > ${from}) AS recovered,
      (SELECT count(*)::int FROM sales WHERE status='approved' AND paid_at > ${from}) AS approved,
      (SELECT coalesce(sum(amount),0)::float FROM sales WHERE status='approved' AND paid_at > ${from}) AS revenue,
      (SELECT count(*)::int FROM sales WHERE status='approved' AND is_rebuy AND paid_at > ${from}) AS rebuys,
      (SELECT coalesce(sum((pricing->>'billable')::int),0)::int FROM messages WHERE direction='out' AND created_at > ${from} AND pricing IS NOT NULL) AS billable`)
  const prev = await one(`
    SELECT
      (SELECT count(*)::int FROM events WHERE source='kirvano' AND created_at BETWEEN ${prevFrom} AND ${from}) AS events,
      (SELECT count(*)::int FROM messages WHERE direction='out' AND created_at BETWEEN ${prevFrom} AND ${from}) AS sent,
      (SELECT count(*)::int FROM funnel_runs WHERE started_at BETWEEN ${prevFrom} AND ${from}) AS runs,
      (SELECT count(*)::int FROM funnel_runs WHERE started_at BETWEEN ${prevFrom} AND ${from} AND replied) AS runs_replied,
      (SELECT count(*)::int FROM funnel_runs WHERE started_at BETWEEN ${prevFrom} AND ${from} AND converted) AS runs_converted,
      (SELECT coalesce(sum(s.amount),0)::float FROM sales s JOIN funnel_runs r ON r.id=s.attributed_run_id WHERE s.paid_at BETWEEN ${prevFrom} AND ${from}) AS recovered`)
  res.json({ days, pix_delay_minutes: delay, current: cur, previous: prev })
}))

// Funil de Pix: gerados → pagos sozinhos (dentro do delay) → elegíveis → enviados → responderam → pagaram
statsRouter.get('/pix-funnel', wrap(async (req, res) => {
  const { from } = range(req)
  const delay = Number(await getSetting('pix_delay_minutes', 7))
  const r = await one(`
    WITH pix AS (SELECT * FROM sales WHERE payment_method='PIX' AND created_at > ${from} AND gateway<>'test'),
    runs AS (SELECT r.* FROM funnel_runs r WHERE r.trigger='pix_generated' AND r.created_at > ${from})
    SELECT
      (SELECT count(*)::int FROM pix) AS generated,
      (SELECT count(*)::int FROM pix WHERE status='approved' AND paid_at <= created_at + interval '${delay} minutes') AS paid_alone,
      (SELECT count(*)::int FROM pix WHERE NOT (status='approved' AND paid_at <= created_at + interval '${delay} minutes')) AS not_paid_in_window,
      (SELECT count(*)::int FROM runs) AS eligible,
      (SELECT count(*)::int FROM runs WHERE started_at IS NOT NULL AND status NOT IN ('failed','cancelled') OR (status='cancelled' AND last_error='pix pago')) AS sent,
      (SELECT count(*)::int FROM runs WHERE replied) AS replied,
      (SELECT count(*)::int FROM runs WHERE converted) AS converted,
      (SELECT coalesce(sum(s.amount),0)::float FROM runs r JOIN sales s ON s.id=r.converted_sale_id) AS recovered_amount,
      (SELECT count(*)::int FROM events WHERE type='automation_skipped' AND created_at > ${from}) AS skipped`)
  res.json(r)
}))

statsRouter.get('/daily', wrap(async (req, res) => {
  const { days } = range(req)
  const rows = await all(`
    WITH d AS (SELECT generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - ${days - 1}, (now() AT TIME ZONE 'America/Sao_Paulo')::date, '1 day')::date AS day)
    SELECT d.day,
      (SELECT count(*)::int FROM sales s WHERE s.payment_method='PIX' AND s.gateway<>'test' AND (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date=d.day) AS pix_generated,
      (SELECT count(*)::int FROM funnel_runs r WHERE r.trigger='pix_generated' AND r.started_at IS NOT NULL AND (r.started_at AT TIME ZONE 'America/Sao_Paulo')::date=d.day) AS contacted,
      (SELECT count(*)::int FROM funnel_runs r WHERE r.converted AND (r.converted_at AT TIME ZONE 'America/Sao_Paulo')::date=d.day) AS recovered,
      (SELECT count(*)::int FROM messages m WHERE m.direction='out' AND (m.created_at AT TIME ZONE 'America/Sao_Paulo')::date=d.day) AS sent,
      (SELECT count(*)::int FROM messages m WHERE m.direction='in' AND (m.created_at AT TIME ZONE 'America/Sao_Paulo')::date=d.day) AS received,
      (SELECT coalesce(sum(s.amount),0)::float FROM sales s JOIN funnel_runs r ON r.id=s.attributed_run_id WHERE (s.paid_at AT TIME ZONE 'America/Sao_Paulo')::date=d.day) AS recovered_amount
    FROM d ORDER BY d.day`)
  res.json(rows)
}))

statsRouter.get('/automations', wrap(async (req, res) => {
  const { from } = range(req)
  res.json(await all(`
    SELECT a.id, a.name, a.trigger, a.active, a.auto_optimize,
      count(r.id) FILTER (WHERE r.started_at IS NOT NULL)::int AS sent,
      count(r.id) FILTER (WHERE r.replied)::int AS replied,
      count(r.id) FILTER (WHERE r.converted)::int AS converted,
      coalesce(sum(s.amount) FILTER (WHERE r.converted),0)::float AS revenue,
      json_agg(DISTINCT jsonb_build_object('funnel_id', r.funnel_id, 'name', f.name)) FILTER (WHERE r.funnel_id IS NOT NULL) AS funnels
    FROM automations a LEFT JOIN funnel_runs r ON r.automation_id=a.id AND r.created_at > ${from}
    LEFT JOIN sales s ON s.id=r.converted_sale_id LEFT JOIN funnels f ON f.id=r.funnel_id
    GROUP BY a.id ORDER BY sent DESC`))
}))

statsRouter.get('/funnels', wrap(async (req, res) => {
  const { from } = range(req)
  res.json(await all(`
    SELECT f.id, f.name, f.status,
      count(r.id) FILTER (WHERE r.started_at IS NOT NULL)::int AS sent,
      count(r.id) FILTER (WHERE r.replied)::int AS replied,
      count(r.id) FILTER (WHERE r.converted)::int AS converted,
      count(r.id) FILTER (WHERE r.status='failed')::int AS failed,
      coalesce(sum(s.amount) FILTER (WHERE r.converted),0)::float AS revenue
    FROM funnels f LEFT JOIN funnel_runs r ON r.funnel_id=f.id AND r.created_at > ${from} LEFT JOIN sales s ON s.id=r.converted_sale_id
    WHERE f.status<>'archived' GROUP BY f.id ORDER BY sent DESC`))
}))

statsRouter.get('/numbers', wrap(async (req, res) => {
  res.json(await all(`
    SELECT n.id, n.label, n.display_phone, n.quality_rating, n.messaging_limit, n.daily_cap, n.status, n.last_error, n.synced_at,
      coalesce(d.sent,0) AS sent_today, coalesce(d.template_sent,0) AS template_sent_today, coalesce(d.delivered,0) AS delivered_today, coalesce(d.failed,0) AS failed_today, coalesce(d.received,0) AS received_today
    FROM numbers n LEFT JOIN number_daily d ON d.number_id=n.id AND d.day=(now() AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY n.id`))
}))

statsRouter.get('/recent', wrap(async (req, res) => {
  res.json(await all(`SELECT e.id, e.type, e.created_at, e.payload, c.name, c.phone, s.amount, s.product_name FROM events e LEFT JOIN contacts c ON c.id=e.contact_id LEFT JOIN sales s ON s.id=e.sale_id WHERE e.type<>'automation_skipped' ORDER BY e.id DESC LIMIT 30`))
}))
