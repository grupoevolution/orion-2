// Normaliza telefone brasileiro para E.164 sem "+" (ex: 5511999990000)
export function normalizePhone(raw) {
  if (!raw) return null
  let d = String(raw).replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('0')) d = d.replace(/^0+/, '')
  if (d.length === 10 || d.length === 11) d = '55' + d
  // celular BR sem o 9: 55 + DDD(2) + 8 dígitos = 12
  if (d.length === 12 && d.startsWith('55')) d = d.slice(0, 4) + '9' + d.slice(4)
  if (d.length < 10 || d.length > 15) return null
  return d
}

export function formatPhone(p) {
  if (!p) return ''
  if (p.startsWith('55') && p.length === 13) return `+55 (${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`
  return '+' + p
}

export function firstName(name) {
  if (!name) return ''
  const n = String(name).trim().split(/\s+/)[0]
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()
}
