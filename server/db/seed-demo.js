// Popula dados de demonstração (contatos, vendas, funil, automação, mensagens) para visualizar o painel.
// Uso: npm run seed:demo   (só em ambiente de teste; marca tudo com tag "demo")
import 'dotenv/config'
import { migrate, pool, q, one } from './index.js'
import { encrypt } from '../lib/crypto.js'

await migrate()
// limpa uma execução anterior
await q(`DELETE FROM sales WHERE sale_id LIKE 'demo-%'`)
await q(`DELETE FROM contacts WHERE 'demo' = ANY(tags)`)
await q(`DELETE FROM campaigns WHERE name='Aviso compradores de agosto'`)
await q(`DELETE FROM automations WHERE name IN ('Pix gerado · 7 min','Boas-vindas')`)
await q(`DELETE FROM funnels WHERE name IN ('Pix gerado · variante A','Pix gerado · variante B','Boas-vindas VIP')`)
const names = ['Rafael Moreira', 'Lucas Silva', 'Diego Almeida', 'Marcos Pereira', 'Thiago Henrique', 'Felipe Costa', 'André Rocha', 'Gabriel Barbosa', 'Bruno Lima', 'Pedro Santos', 'João Vitor', 'Caio Mendes', 'Rodrigo Nunes', 'Vinícius Alves', 'Matheus Cardoso', 'Leandro Souza', 'Eduardo Freitas', 'Fábio Ramos', 'Gustavo Martins', 'Henrique Dias']
const products = [['VIP', 29.9], ['Premium', 49.9], ['Status VIP', 19.9], ['Upgrade Premium', 30], ['Passe Vitalício', 97]]

const num = await one(`INSERT INTO numbers (label, phone_number_id, waba_id, display_phone, verified_name, token_enc, quality_rating, messaging_limit, is_default, status)
  VALUES ('Principal (demo)','demo-phone-1','demo-waba','+55 11 99999-4410','Orion Demo',$1,'GREEN','TIER_1K',true,'paused')
  ON CONFLICT (phone_number_id) DO UPDATE SET label=EXCLUDED.label RETURNING *`, [encrypt('demo-token')])
await q(`INSERT INTO templates (waba_id, meta_id, name, language, category, status, components, variables) VALUES ('demo-waba','demo-t1','pix_gerado_v3','pt_BR','UTILITY','APPROVED',$1,$2) ON CONFLICT DO NOTHING`,
  [JSON.stringify([{ type: 'BODY', text: '{{1}}, {{2}}! Vi que seu Pix de {{3}} para o {{4}} ainda está pendente. Quer que eu te envie o código de novo?' }]), JSON.stringify([{ index: 1, name: 'saudacao' }, { index: 2, name: 'primeiro_nome' }, { index: 3, name: 'valor' }, { index: 4, name: 'produto' }])])
await q(`INSERT INTO templates (waba_id, meta_id, name, language, category, status, components) VALUES ('demo-waba','demo-t2','boas_vindas_vip','pt_BR','UTILITY','APPROVED',$1) ON CONFLICT DO NOTHING`,
  [JSON.stringify([{ type: 'BODY', text: 'Bem-vindo, {{1}}! Seu acesso já está liberado. Entre com o e-mail {{2}} no app.' }, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir o app', url: 'https://example.com' }] }])])
const tpl = await one(`SELECT id FROM templates WHERE name='pix_gerado_v3'`)

const nodes = [
  { id: 'trigger', type: 'trigger', position: { x: 60, y: 200 }, data: { label: 'Pix gerado' } },
  { id: 'n1', type: 'template', position: { x: 360, y: 180 }, data: { label: 'Template pix_gerado_v3', template_id: tpl.id, values: { 1: '{{saudacao}}', 2: '{{primeiro_nome}}', 3: '{{valor}}', 4: '{{produto}}' } } },
  { id: 'n2', type: 'wait_reply', position: { x: 680, y: 180 }, data: { label: 'Esperar resposta', timeout_seconds: 7200, save_as: 'resposta' } },
  { id: 'n3', type: 'buttons', position: { x: 1000, y: 80 }, data: { label: 'Botões', body: 'Vou te mandar o código, é só copiar e colar no app do banco. Precisa de ajuda?', buttons: [{ id: 'codigo', title: 'Me manda o código' }, { id: 'pago', title: 'Já paguei' }] } },
  { id: 'n4', type: 'text', position: { x: 1320, y: 20 }, data: { label: 'Código Pix', text: 'Aqui está: {{pix_copia_cola}}' } },
  { id: 'n5', type: 'end', position: { x: 1320, y: 180 }, data: { label: 'Encerrar', outcome: 'pagou sozinho' } },
  { id: 'n6', type: 'end', position: { x: 1000, y: 340 }, data: { label: 'Sem resposta' } }
]
const edges = [
  { id: 'e0', source: 'trigger', target: 'n1' }, { id: 'e1', source: 'n1', target: 'n2' },
  { id: 'e2', source: 'n2', sourceHandle: 'reply', target: 'n3' }, { id: 'e3', source: 'n2', sourceHandle: 'timeout', target: 'n6' },
  { id: 'e4', source: 'n3', sourceHandle: 'codigo', target: 'n4' }, { id: 'e5', source: 'n3', sourceHandle: 'pago', target: 'n5' }
]
const fA = await one(`INSERT INTO funnels (name, description, status, version, nodes, edges, published_at) VALUES ('Pix gerado · variante A','Template direto + código','published',2,$1,$2,now()) RETURNING id`, [JSON.stringify(nodes), JSON.stringify(edges)])
const fB = await one(`INSERT INTO funnels (name, description, status, version, nodes, edges, published_at) VALUES ('Pix gerado · variante B','Com botões de ajuda','published',3,$1,$2,now()) RETURNING id`, [JSON.stringify(nodes), JSON.stringify(edges)])
const fW = await one(`INSERT INTO funnels (name, description, status, version, nodes, edges, published_at) VALUES ('Boas-vindas VIP','Pós-compra','published',1,$1,$2,now()) RETURNING id`, [JSON.stringify(nodes.slice(0, 2)), JSON.stringify(edges.slice(0, 1))])
const auto = await one(`INSERT INTO automations (name, trigger, active, delay_seconds, min_amount, variants, auto_optimize) VALUES ('Pix gerado · 7 min','pix_generated',true,420,19.9,$1,true) RETURNING id`, [JSON.stringify([{ funnel_id: fA.id, weight: 1 }, { funnel_id: fB.id, weight: 1 }])])
await q(`INSERT INTO automations (name, trigger, active, delay_seconds, variants) VALUES ('Boas-vindas','approved',true,60,$1)`, [JSON.stringify([{ funnel_id: fW.id, weight: 1 }])])

let i = 0
for (let day = 13; day >= 0; day--) {
  for (let k = 0; k < 8; k++) {
    const n = names[(i++) % names.length]
    const phone = '55119' + String(10000000 + i * 137).slice(0, 8)
    const c = await one(`INSERT INTO contacts (phone, name, email, source, tags, owner_number_id, window_expires_at, last_inbound_at) VALUES ($1,$2,$3,'kirvano','{demo}',$4, CASE WHEN $5 THEN now() + interval '20 hours' END, CASE WHEN $5 THEN now() - interval '4 hours' END)
      ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name RETURNING *`, [phone, n, n.toLowerCase().replace(/\s+/g, '.') + '@gmail.com', num.id, day === 0 && k < 5])
    const [prod, price] = products[i % products.length]
    const created = `now() - interval '${day} days' - interval '${k * 97 % 720} minutes'`
    const r = Math.random()
    const paidAlone = r < 0.38, contacted = !paidAlone && price >= 19.9, converted = contacted && Math.random() < 0.27, replied = contacted && (converted || Math.random() < 0.3)
    const sale = await one(`INSERT INTO sales (gateway, sale_id, contact_id, status, payment_method, amount, product_name, offer_name, pix_code, created_at, paid_at)
      VALUES ('kirvano',$1,$2,$3,'PIX',$4,$5,$5,'00020126580014br.gov.bcb.pix0136demo',${created}, CASE WHEN $3='approved' THEN ${created} + interval '${paidAlone ? 3 : 40} minutes' END) RETURNING *`,
      [`demo-${i}`, c.id, paidAlone || converted ? 'approved' : 'pending', price, prod])
    await q(`INSERT INTO events (source,type,contact_id,sale_id,payload,created_at) VALUES ('kirvano','pix_generated',$1,$2,'{}',${created})`, [c.id, sale.id])
    if (paidAlone || converted) { await q(`INSERT INTO events (source,type,contact_id,sale_id,payload,created_at) VALUES ('kirvano','approved',$1,$2,'{}',${created} + interval '30 minutes')`, [c.id, sale.id]); await q(`UPDATE contacts SET total_purchases=total_purchases+1, total_spent=total_spent+$2, last_purchase_at=now() WHERE id=$1`, [c.id, price]) }
    if (contacted) {
      const fid = Math.random() < 0.5 ? fA.id : fB.id
      const run = await one(`INSERT INTO funnel_runs (funnel_id, funnel_version, automation_id, contact_id, number_id, sale_id, trigger, status, replied, converted, converted_sale_id, converted_at, started_at, ended_at, created_at)
        VALUES ($1,1,$2,$3,$4,$5,'pix_generated','done',$6,$7,$8, CASE WHEN $7 THEN ${created} + interval '40 minutes' END, ${created} + interval '7 minutes', ${created} + interval '2 hours', ${created}) RETURNING id`,
        [fid, auto.id, c.id, num.id, sale.id, replied, converted, converted ? sale.id : null])
      if (converted) await q('UPDATE sales SET attributed_run_id=$2 WHERE id=$1', [sale.id, run.id])
      const conv = await one(`INSERT INTO conversations (contact_id, number_id, last_message_at, last_preview, last_direction, unread) VALUES ($1,$2,${created} + interval '${replied ? 31 : 7} minutes',$3,$4,$5) ON CONFLICT (contact_id,number_id) DO UPDATE SET last_message_at=EXCLUDED.last_message_at RETURNING id`,
        [c.id, num.id, replied ? 'Consegui não, tá dando erro aqui' : 'Vi que seu Pix ainda está pendente…', replied ? 'in' : 'out', replied && day === 0 ? 1 : 0])
      await q(`INSERT INTO messages (conversation_id, contact_id, number_id, direction, wa_message_id, type, body, template_name, status, funnel_run_id, created_at, sent_at, delivered_at, read_at) VALUES ($1,$2,$3,'out',$4,'template',$5,'pix_gerado_v3',$6,$7,${created} + interval '7 minutes',${created} + interval '7 minutes',${created} + interval '8 minutes', CASE WHEN $6='read' THEN ${created} + interval '12 minutes' END)`,
        [conv.id, c.id, num.id, `demo-out-${i}`, `Boa tarde, ${n.split(' ')[0]}! Vi que seu Pix de R$ ${price.toFixed(2).replace('.', ',')} para o ${prod} ainda está pendente. Quer que eu te envie o código de novo?`, replied ? 'read' : (Math.random() < 0.7 ? 'read' : 'delivered'), run.id])
      if (replied) {
        await q(`INSERT INTO messages (conversation_id, contact_id, number_id, direction, wa_message_id, type, body, status, created_at) VALUES ($1,$2,$3,'in',$4,'text','Consegui não, tá dando erro aqui','received',${created} + interval '31 minutes')`, [conv.id, c.id, num.id, `demo-in-${i}`])
        await q(`INSERT INTO messages (conversation_id, contact_id, number_id, direction, wa_message_id, type, body, status, funnel_run_id, created_at, sent_at, delivered_at) VALUES ($1,$2,$3,'out',$4,'interactive','Vou te mandar o código, é só copiar e colar no app do banco. Precisa de ajuda?','delivered',$5,${created} + interval '31 minutes',${created} + interval '31 minutes',${created} + interval '32 minutes')`, [conv.id, c.id, num.id, `demo-out2-${i}`, run.id])
        await q(`UPDATE messages SET payload=$2 WHERE wa_message_id=$1`, [`demo-out2-${i}`, JSON.stringify({ type: 'interactive', interactive: { type: 'button', body: { text: 'Vou te mandar o código, é só copiar e colar no app do banco. Precisa de ajuda?' }, action: { buttons: [{ type: 'reply', reply: { id: 'codigo', title: 'Me manda o código' } }, { type: 'reply', reply: { id: 'pago', title: 'Já paguei' } }] } } })])
      }
      await q(`INSERT INTO number_daily (number_id, day, sent, delivered, read, received, template_sent) VALUES ($1, ((${created}) AT TIME ZONE 'America/Sao_Paulo')::date, 1, 1, $2, $3, 1) ON CONFLICT (number_id, day) DO UPDATE SET sent=number_daily.sent+1, delivered=number_daily.delivered+1, read=number_daily.read+$2, received=number_daily.received+$3, template_sent=number_daily.template_sent+1`, [num.id, replied ? 1 : 0, replied ? 1 : 0])
    }
  }
}
const camp = await one(`INSERT INTO campaigns (name, kind, template_id, template_params, daily_limit, per_minute, status, stats) VALUES ('Aviso compradores de agosto','template',$1,'{"1":"Boa tarde","2":"{{primeiro_nome}}"}',100,10,'running','{}') RETURNING id`, [tpl.id])
const cs = await pool.query('SELECT id FROM contacts WHERE $1 = ANY(tags) LIMIT 60', ['demo'])
for (const [idx, r] of cs.rows.entries()) await q(`INSERT INTO campaign_contacts (campaign_id, contact_id, status, sent_at) VALUES ($1,$2,$3, CASE WHEN $3<>'pending' THEN now() - interval '3 hours' END) ON CONFLICT DO NOTHING`, [camp.id, r.id, idx < 25 ? (idx % 4 === 0 ? 'read' : 'delivered') : 'pending'])
await q(`UPDATE campaigns SET stats='{"total":60,"pending":35,"delivered":19,"read":6}' WHERE id=$1`, [camp.id])
console.log('✓ dados de demonstração criados (tag "demo", número em pausa)')
await pool.end()
