// Variáveis de contexto e renderização de texto {{var}}
import { firstName, formatPhone } from './phone.js'

const TZ = 'America/Sao_Paulo'

export function hourIn(tz = TZ, date = new Date()) {
  return Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: tz }).format(date))
}

export function greeting(greet = { morning: 'Bom dia', afternoon: 'Boa tarde', night: 'Boa noite' }, tz = TZ) {
  const h = hourIn(tz)
  if (h >= 5 && h < 12) return greet.morning
  if (h >= 12 && h < 18) return greet.afternoon
  return greet.night
}

export const money = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')

export function buildContext({ contact, sale, run, settings = {} }) {
  const g = settings.greeting || undefined
  return {
    saudacao: greeting(g),
    nome: contact?.name || '',
    primeiro_nome: firstName(contact?.name) || '',
    email: contact?.email || '',
    telefone: formatPhone(contact?.phone),
    valor: sale ? money(sale.amount) : '',
    valor_numero: sale ? Number(sale.amount || 0) : '',
    produto: sale?.product_name || '',
    oferta: sale?.offer_name || '',
    pix_copia_cola: sale?.pix_code || '',
    link_pagamento: sale?.payment_link || '',
    metodo_pagamento: sale?.payment_method || '',
    total_compras: contact?.total_purchases ?? 0,
    resposta: run?.variables?.resposta || '',
    ...(contact?.variables || {}),
    ...(run?.variables || {})
  }
}

export function render(text, ctx) {
  if (!text) return ''
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), ctx)
    return v == null ? '' : String(v)
  })
}

export const VARIABLES = [
  { key: 'saudacao', label: 'Saudação por horário', example: 'Boa tarde' },
  { key: 'nome', label: 'Nome completo', example: 'Rafael Moreira' },
  { key: 'primeiro_nome', label: 'Primeiro nome', example: 'Rafael' },
  { key: 'email', label: 'E-mail', example: 'rafael@gmail.com' },
  { key: 'telefone', label: 'Telefone', example: '+55 (11) 99999-0000' },
  { key: 'valor', label: 'Valor do Pix/venda', example: 'R$ 49,90' },
  { key: 'produto', label: 'Produto', example: 'Premium' },
  { key: 'oferta', label: 'Oferta', example: 'Premium mensal' },
  { key: 'pix_copia_cola', label: 'Código Pix copia e cola', example: '00020126…' },
  { key: 'link_pagamento', label: 'Link de pagamento', example: 'https://…' },
  { key: 'resposta', label: 'Última resposta do cliente', example: 'quero sim' },
  { key: 'total_compras', label: 'Total de compras', example: '2' }
]

// Palavras que costumam fazer a Meta reclassificar template UTILITY -> MARKETING
const PROMO = ['desconto', 'promoção', 'promocao', 'oferta', 'cupom', 'grátis', 'gratis', 'imperdível', 'imperdivel', 'aproveite', 'últimas', 'ultimas', 'bônus', 'bonus', 'presente', 'só hoje', 'so hoje', 'liquidação', 'black friday', 'garanta', 'novidade', 'lançamento', 'lancamento', 'exclusivo', 'compre']
export function categoryCheck(text = '') {
  const t = text.toLowerCase()
  const hits = PROMO.filter(w => t.includes(w))
  return { ok: hits.length === 0, hits }
}
