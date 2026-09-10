// Conversas — inbox estilo WhatsApp Web (lista · chat · contato)
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { api, subscribe, fmtPhone, fmtTime, fmtDate, fmtDateTime, fmtRel, fmtMoney, fmtWindow } from '../lib/api'
import { useToast, Modal, Toggle, Empty, Spinner, Segmented, Field, Avatar, Icon, ConfirmButton } from '../components/ui'
import './Inbox.css'

type Filter = 'all' | 'unread' | 'window' | 'pix'
const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'Todas' }, { value: 'unread', label: 'Não lidas' }, { value: 'window', label: 'Janela aberta' }, { value: 'pix', label: 'Pix pendente' }]
const SOURCES: Record<string, string> = { kirvano: 'Kirvano', ad: 'Anúncio', import: 'Importação', inbound: 'Recebida', manual: 'Manual', unknown: 'Desconhecida' }
const EVENT_LABELS: Record<string, string> = { abandoned: 'Abandonou o checkout', refunded: 'Reembolsado', chargeback: 'Chargeback', ad_lead: 'Chegou pelo anúncio', inbound: 'Enviou mensagem', inbound_new: 'Primeira mensagem', optout: 'Pediu para não receber', automation_skipped: 'Automação pulada', tag_added: 'Tag adicionada' }

function useDebounce<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms]); return d }

const dayLabel = (d: any) => { const dt = new Date(d), now = new Date(); const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); const diff = (day(now) - day(dt)) / 86400e3; return diff === 0 ? 'Hoje' : diff === 1 ? 'Ontem' : dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: dt.getFullYear() !== now.getFullYear() ? 'numeric' : undefined }) }

const URL_RE = /(https?:\/\/[^\s<]+)/g
function Linkify({ text }: { text: string }) {
  return <>{String(text || '').split(URL_RE).map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : <React.Fragment key={i}>{p}</React.Fragment>)}</>
}

function Tick({ m }: { m: any }) {
  if (m.direction !== 'out') return null
  if (m.status === 'failed') return <span className="tick fail" title={m.error || 'Falha no envio'}>⚠</span>
  if (m.status === 'read') return <span className="tick read">✓✓</span>
  if (m.status === 'delivered') return <span className="tick">✓✓</span>
  if (m.status === 'sent') return <span className="tick">✓</span>
  return <span className="tick">○</span>
}

function AudioMsg({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false), [cur, setCur] = useState(0), [dur, setDur] = useState(0)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const toggle = () => { const a = ref.current; if (!a) return; playing ? a.pause() : a.play() }
  return <div className="audio">
    <audio ref={ref} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={e => setCur((e.target as HTMLAudioElement).currentTime)} onLoadedMetadata={e => setDur((e.target as HTMLAudioElement).duration || 0)} style={{ display: 'none' }} />
    <button className="play" onClick={toggle} aria-label={playing ? 'Pausar' : 'Tocar'}><Icon name={playing ? 'pause' : 'play'} size={13} /></button>
    <div className="bar" onClick={e => { const a = ref.current; if (!a || !dur) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); a.currentTime = ((e.clientX - r.left) / r.width) * dur }}><i><b style={{ width: dur ? `${(cur / dur) * 100}%` : '0%' }} /></i></div>
    <span className="dur">{playing || cur > 0 ? fmt(cur) : fmt(dur)}</span>
  </div>
}

function Bubble({ m, onImage }: { m: any; onImage: (u: string) => void }) {
  const out = m.direction === 'out'
  const p = m.payload || {}
  const inter = p.interactive || {}
  const body = () => {
    switch (m.type) {
      case 'image': return <>{m.media_url ? <img className="pic" src={m.media_url} alt="" onClick={() => onImage(m.media_url)} /> : <div className="ph">📷 baixando…</div>}{m.body && <div className="cap"><Linkify text={m.body} /></div>}</>
      case 'sticker': return m.media_url ? <img className="stk" src={m.media_url} alt="Figurinha" /> : <div className="ph">Figurinha</div>
      case 'video': return <>{m.media_url ? <video controls src={m.media_url} /> : <div className="ph">🎬 baixando…</div>}{m.body && <div className="cap"><Linkify text={m.body} /></div>}</>
      case 'audio': return m.media_url ? <AudioMsg src={m.media_url} /> : <div className="audio"><span className="dur">🎤 baixando…</span></div>
      case 'document': return <><div className="doc"><Icon name="file" size={22} /><div className="fn">{m.media_filename || 'Documento'}<small>{m.media_mime || ''}</small></div>{m.media_url && <a className="btn g sm icon" href={m.media_url} download={m.media_filename || true} title="Baixar"><Icon name="download" size={14} /></a>}</div>{m.body && <div className="cap"><Linkify text={m.body} /></div>}</>
      case 'interactive': case 'button': {
        if (!out) return <Linkify text={m.body || inter.button_reply?.title || inter.list_reply?.title || p.button?.text || 'Resposta interativa'} />
        const btns: any[] = inter.action?.buttons?.map((b: any) => b.reply?.title) || inter.action?.sections?.flatMap((s: any) => s.rows.map((r: any) => r.title)) || (inter.action?.parameters?.display_text ? [inter.action.parameters.display_text] : [])
        return <>{inter.header?.text && <div className="hdr">{inter.header.text}</div>}<Linkify text={inter.body?.text || m.body || ''} />{inter.footer?.text && <div className="ftr">{inter.footer.text}</div>}{btns.length > 0 && <div className="btns">{btns.map((b, i) => <span key={i}>{b}</span>)}</div>}</>
      }
      case 'location': return <>📍 Localização{m.body ? `: ${m.body}` : ''}</>
      case 'contacts': return <>👤 Contato compartilhado{m.body ? `: ${m.body}` : ''}</>
      case 'reaction': return <>Reagiu {m.body || ''}</>
      case 'unsupported': return <span className="muted">Tipo de mensagem não suportado</span>
      case 'template': return <Linkify text={m.body || `Template ${m.template_name || ''}`} />
      default: return <Linkify text={m.body || ''} />
    }
  }
  return <div className={'b ' + (out ? 'out' : 'in')}>
    {m.type === 'template' && <span className="tpl">Template · {m.template_name || p.template?.name || ''}</span>}
    <div style={{ whiteSpace: 'pre-wrap' }}>{body()}</div>
    <span className="t">{m.funnel_run_id ? <span className="src">Funil</span> : m.campaign_id ? <span className="src">Campanha</span> : null}{fmtTime(m.created_at)}<Tick m={m} /></span>
  </div>
}

// ---- modal de template ----
function TemplateModal({ onClose, onSend, hint }: { onClose: () => void; onSend: (template_id: number, values: Record<string, string>) => Promise<void>; hint?: string }) {
  const [tpls, setTpls] = useState<any[] | null>(null), [vars, setVars] = useState<any[]>([]), [sel, setSel] = useState<any>(null), [values, setValues] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false)
  useEffect(() => { api.get('/templates').then((r: any[]) => setTpls(r.filter(t => t.status === 'APPROVED'))).catch(() => setTpls([])); api.get('/variables').then(setVars).catch(() => {}) }, [])
  const bodyText = sel ? (sel.components || []).find((c: any) => c.type === 'BODY')?.text || '' : ''
  const idxs = useMemo(() => { const s = new Set<string>(); for (const mm of bodyText.matchAll(/\{\{(\d+)\}\}/g)) s.add(mm[1]); (sel?.variables || []).forEach((v: any) => s.add(String(v.index))); return Array.from(s).sort((a, b) => Number(a) - Number(b)) }, [sel, bodyText])
  const preview = bodyText.replace(/\{\{(\d+)\}\}/g, (_: string, i: string) => values[i] || `{{${i}}}`)
  const [focus, setFocus] = useState<string | null>(null)
  const insert = (key: string) => { if (!focus) return; setValues(v => ({ ...v, [focus]: (v[focus] || '') + `{{${key}}}` })) }
  return <Modal title="Enviar template" onClose={onClose} size="lg" footer={<><button className="btn g" onClick={onClose}>Cancelar</button><button className="btn p" disabled={!sel || busy} onClick={async () => { setBusy(true); try { await onSend(sel.id, values); onClose() } finally { setBusy(false) } }}>{busy ? 'Enviando…' : 'Enviar template'}</button></>}>
    {hint && <p className="muted" style={{ marginTop: 0 }}>{hint}</p>}
    {tpls === null ? <Spinner /> : tpls.length === 0 ? <Empty title="Nenhum template aprovado">Crie e aprove um template na página Templates.</Empty> :
      <div className="grid g2">
        <div className="tpl-list">{tpls.map(t => <button key={t.id} className={'tpl-item' + (sel?.id === t.id ? ' on' : '')} onClick={() => { setSel(t); setValues({}) }}><div><b>{t.name}</b><small>{t.language} · {t.category}</small></div><span className={'tag' + (t.category === 'MARKETING' ? ' b' : '')}>{t.category}</span></button>)}</div>
        <div>
          {!sel ? <p className="muted">Escolha um template ao lado.</p> : <>
            {idxs.map(i => { const name = (sel.variables || []).find((v: any) => String(v.index) === i)?.name; return <Field key={i} label={`{{${i}}}${name ? ' · ' + name : ''}`}><input className="inp" value={values[i] || ''} onFocus={() => setFocus(i)} onChange={e => setValues(v => ({ ...v, [i]: e.target.value }))} placeholder="Valor ou variável" /></Field> })}
            {idxs.length > 0 && vars.length > 0 && <div className="chips" style={{ marginBottom: 12 }}>{vars.map(v => <span key={v.key} className="chip" title={v.label} onClick={() => insert(v.key)}>{`{{${v.key}}}`}</span>)}</div>}
            <div className="field"><label>Prévia</label><div className="tpl-prev">{preview}</div></div>
          </>}
        </div>
      </div>}
  </Modal>
}

// ---- coluna direita: contato ----
function ContactPanel({ conv, onSendText }: { conv: any; onSendText: (t: string) => Promise<boolean> }) {
  const { toast } = useToast()
  const [c, setC] = useState<any>(null), [tagInput, setTagInput] = useState<string | null>(null)
  const load = useCallback(() => api.get(`/contacts/${conv.contact_id}`).then(setC).catch(() => {}), [conv.contact_id])
  useEffect(() => { setC(null); load() }, [load])
  if (!c) return <div className="cinfo"><Spinner /></div>
  const lastSale = c.sales?.[0]
  const pix = lastSale?.status === 'pending' ? lastSale : null
  const timeline = [
    ...(c.sales || []).map((s: any) => ({ at: s.created_at, k: s.status === 'approved' ? 'g' : s.status === 'pending' ? 'w' : s.status === 'refused' ? 'r' : '', txt: s.status === 'approved' ? `Comprou ${s.product_name || ''} ${fmtMoney(s.amount)}` : s.status === 'pending' ? `Gerou Pix ${s.product_name || ''} ${fmtMoney(s.amount)}` : s.status === 'refused' ? `Pagamento recusado ${s.product_name || ''}` : `${s.status} ${s.product_name || ''} ${fmtMoney(s.amount)}` })),
    ...(c.runs || []).map((r: any) => ({ at: r.created_at, k: r.converted ? 'g' : r.status === 'failed' ? 'r' : 'b', txt: `Funil "${r.funnel_name || r.funnel_id}" ${({ scheduled: 'agendado', running: 'em andamento', waiting_reply: 'aguardando resposta', waiting_delay: 'aguardando', done: 'concluído', cancelled: 'cancelado', failed: 'falhou' } as any)[r.status] || r.status}${r.replied ? ' · respondeu' : ''}${r.converted ? ' · converteu' : ''}` })),
    ...(c.events || []).filter((e: any) => !['pix_generated', 'approved', 'refused'].includes(e.type)).map((e: any) => ({ at: e.created_at, k: '', txt: EVENT_LABELS[e.type] || e.type }))
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  const addTag = async (tag: string) => { if (!tag.trim()) return; try { setC(await api.post(`/contacts/${c.id}/tags`, { tag: tag.trim() })); setTagInput(null) } catch (e: any) { toast(e.message, true) } }
  const rmTag = async (tag: string) => { try { setC(await api.post(`/contacts/${c.id}/tags`, { tag, remove: true })) } catch (e: any) { toast(e.message, true) } }
  return <div className="cinfo">
    <div><Avatar name={c.name || c.phone} size="lg" /><h5>{c.name || fmtPhone(c.phone)}</h5><p className="mail" title={c.email || ''}>{c.email || fmtPhone(c.phone)}</p></div>
    <div className="kv">
      <span>Número dono</span><b>{conv.number_label || '—'}</b>
      <span>Compras</span><b>{c.total_purchases || 0} · {fmtMoney(c.total_spent)}</b>
      <span>Primeiro contato</span><b>{fmtDate(c.created_at)}</b>
      <span>Origem</span><b>{SOURCES[c.source] || c.source || '—'}</b>
    </div>
    <div className="chips">
      {(c.tags || []).map((t: string) => <span key={t} className="chip" title="Remover" onClick={() => rmTag(t)}>{t} ×</span>)}
      {tagInput === null ? <span className="chip add" onClick={() => setTagInput('')}>+ tag</span> :
        <input className="inp" style={{ width: 120, padding: '2px 7px', fontSize: 11 }} autoFocus value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTag(tagInput); if (e.key === 'Escape') setTagInput(null) }} onBlur={() => tagInput ? addTag(tagInput) : setTagInput(null)} placeholder="nova tag" />}
    </div>
    <Toggle on={!!c.opted_out} onChange={async v => { try { setC({ ...c, ...(await api.put(`/contacts/${c.id}`, { opted_out: v })) }) } catch (e: any) { toast(e.message, true) } }} label={<span style={{ fontSize: 12 }}>Não receber mensagens</span>} />
    {pix && <>
      <div className="sec">Pix pendente</div>
      <div className="kv"><span>{pix.product_name || 'Produto'}</span><b>{fmtMoney(pix.amount)}</b><span>Gerado</span><b>{fmtTime(pix.created_at)}</b></div>
      {pix.pix_code && <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={!conv.window_open} title={conv.window_open ? '' : 'Janela fechada — envie um template'} onClick={async () => { if (await onSendText(pix.pix_code)) toast('Código Pix reenviado') }}>Reenviar código Pix</button>}
    </>}
    <div className="sec">Linha do tempo</div>
    {timeline.length === 0 && <span className="dim">Nada ainda.</span>}
    {timeline.slice(0, 40).map((e, i) => <div key={i} className="ev"><i className={e.k} /><div>{e.txt}<span>{fmtDateTime(e.at)}</span></div></div>)}
    <Link to={`/contatos/${c.id}`} className="btn g sm" style={{ justifyContent: 'center' }}>Ver contato completo <Icon name="external" size={13} /></Link>
  </div>
}

// ---- página ----
export default function Inbox() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const selId = id ? Number(id) : null

  const [numbers, setNumbers] = useState<any[]>([])
  const [numberId, setNumberId] = useState<string>('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const dSearch = useDebounce(search)
  const [convs, setConvs] = useState<any[]>([])
  const [loadingList, setLoadingList] = useState(true), [hasMore, setHasMore] = useState(false)
  const [newConv, setNewConv] = useState(false)

  const [msgs, setMsgs] = useState<any[]>([]), [loadingMsgs, setLoadingMsgs] = useState(false), [moreMsgs, setMoreMsgs] = useState(false)
  const [text, setText] = useState(''), [sending, setSending] = useState(false), [menu, setMenu] = useState(false), [tplModal, setTplModal] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [rec, setRec] = useState<{ mr: MediaRecorder; started: number } | null>(null), [recSec, setRecSec] = useState(0)
  const [, tick] = useState(0)

  const msgsRef = useRef<HTMLDivElement>(null), taRef = useRef<HTMLTextAreaElement>(null), fileRef = useRef<HTMLInputElement>(null), pendingKind = useRef<string>('')
  const keepScroll = useRef<{ h: number; top: number } | null>(null)

  const conv = useMemo(() => convs.find(c => c.id === selId) || null, [convs, selId])
  const [convExtra, setConvExtra] = useState<any>(null) // conversa selecionada que não está na lista carregada
  const cur = conv || (convExtra?.id === selId ? convExtra : null)

  useEffect(() => { api.get('/numbers').then(setNumbers).catch(() => {}) }, [])

  const listQuery = (before?: string) => `/conversations?filter=${filter}&limit=40${numberId !== 'all' ? `&number_id=${numberId}` : ''}${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`
  const loadList = useCallback(async () => { setLoadingList(true); try { const r: any[] = await api.get(listQuery()); setConvs(r); setHasMore(r.length >= 40) } catch (e: any) { toast(e.message, true) } finally { setLoadingList(false) } }, [filter, numberId, dSearch])
  useEffect(() => { loadList() }, [loadList])
  const loadMoreList = async () => { const last = convs[convs.length - 1]?.last_message_at; if (!last) return; try { const r: any[] = await api.get(listQuery(last)); setConvs(c => [...c, ...r.filter(x => !c.some(y => y.id === x.id))]); setHasMore(r.length >= 40) } catch (e: any) { toast(e.message, true) } }

  // conversa selecionada fora da lista → busca via contatos? não há GET /conversations/:id; usa lista sem filtro
  useEffect(() => { if (selId && !conv && !loadingList) api.get(`/conversations?limit=200`).then((r: any[]) => { const f = r.find(c => c.id === selId); if (f) setConvExtra(f) }).catch(() => {}) }, [selId, conv, loadingList])

  // mensagens
  useEffect(() => {
    if (!selId) { setMsgs([]); return }
    let alive = true; setLoadingMsgs(true); setMsgs([])
    api.get(`/conversations/${selId}/messages?limit=60`).then((r: any[]) => { if (!alive) return; setMsgs(r); setMoreMsgs(r.length >= 60); setConvs(cs => cs.map(c => c.id === selId ? { ...c, unread: 0 } : c)) }).catch((e: any) => toast(e.message, true)).finally(() => alive && setLoadingMsgs(false))
    api.post(`/conversations/${selId}/read`).catch(() => {})
    setText(''); setMenu(false)
    return () => { alive = false }
  }, [selId])
  const loadOlder = async () => { const first = msgs[0]?.id; if (!first || !selId) return; const el = msgsRef.current; keepScroll.current = el ? { h: el.scrollHeight, top: el.scrollTop } : null; try { const r: any[] = await api.get(`/conversations/${selId}/messages?limit=60&before=${first}`); setMsgs(m => [...r, ...m]); setMoreMsgs(r.length >= 60) } catch (e: any) { toast(e.message, true) } }
  useLayoutEffect(() => { const el = msgsRef.current; if (!el) return; if (keepScroll.current) { el.scrollTop = el.scrollHeight - keepScroll.current.h + keepScroll.current.top; keepScroll.current = null } else el.scrollTop = el.scrollHeight }, [msgs])

  // tempo real
  const selRef = useRef(selId); selRef.current = selId
  useEffect(() => {
    const off = subscribe({
      message: d => {
        const m = d.message; if (!m) return
        if (d.conversation_id === selRef.current) { setMsgs(ms => ms.some(x => x.id === m.id) ? ms.map(x => x.id === m.id ? { ...x, ...m } : x) : [...ms, m]); if (m.direction === 'in') api.post(`/conversations/${d.conversation_id}/read`).catch(() => {}) }
        setConvs(cs => {
          const i = cs.findIndex(c => c.id === d.conversation_id)
          const preview = m.type === 'text' || m.type === 'template' ? m.body : ({ image: '📷 Imagem', video: '🎬 Vídeo', audio: '🎤 Áudio', document: '📄 Documento', sticker: 'Figurinha', interactive: m.body || 'Mensagem interativa' } as any)[m.type] || m.body || m.type
          if (i < 0) { loadList(); return cs }
          const c = { ...cs[i], last_message_at: m.created_at, last_preview: preview, last_direction: m.direction, unread: m.direction === 'in' && d.conversation_id !== selRef.current ? (cs[i].unread || 0) + 1 : cs[i].unread, ...(m.direction === 'in' ? { window_open: true, window_expires_at: new Date(Date.now() + 24 * 3600e3).toISOString() } : {}) }
          return [c, ...cs.filter((_, j) => j !== i)]
        })
      },
      status: d => { if (d.conversation_id === selRef.current) setMsgs(ms => ms.map(x => x.id === d.message_id ? { ...x, status: d.status, error: d.error ?? x.error, ...(d.media_id ? { media_id: d.media_id } : {}) } : x)) }
    })
    return off
  }, [loadList])
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t) }, [])

  // envio
  const send = async (body: any): Promise<boolean> => {
    if (!selId) return false
    setSending(true)
    try { const m = await api.post(`/conversations/${selId}/send`, body); setMsgs(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]); return true }
    catch (e: any) { if (e.code === 'WINDOW_CLOSED' || e.status === 409) { toast('Janela de 24h fechada — envie um template.', true); setTplModal('A janela de 24h está fechada. Só templates aprovados podem reabrir a conversa.') } else toast(e.message, true); return false }
    finally { setSending(false) }
  }
  const sendText = async () => { const t = text.trim(); if (!t || sending) return; setText(''); if (taRef.current) taRef.current.style.height = 'auto'; if (!(await send({ type: 'text', text: t }))) setText(t) }
  const onFile = async (f: File | null) => { if (!f) return; try { toast('Enviando arquivo…'); const m = await api.upload('/media', f, pendingKind.current ? { kind: pendingKind.current } : {}); await send({ type: 'media', media_id: m.id, text: text.trim() || undefined }); setText('') } catch (e: any) { toast(e.message, true) } finally { if (fileRef.current) fileRef.current.value = '' } }
  const pickFile = (kind: string, accept: string) => { pendingKind.current = kind; setMenu(false); if (fileRef.current) { fileRef.current.accept = accept; fileRef.current.click() } }

  const canRecord = typeof window !== 'undefined' && !!(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || ''
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); const chunks: Blob[] = []
      mr.ondataavailable = e => e.data.size && chunks.push(e.data)
      mr.onstop = async () => { stream.getTracks().forEach(t => t.stop()); if ((mr as any)._cancel) return; const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' }); const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'; const f = new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type }); try { const m = await api.upload('/media', f, { kind: 'audio' }); await send({ type: 'media', media_id: m.id }) } catch (e: any) { toast(e.message, true) } }
      mr.start(); setRec({ mr, started: Date.now() }); setRecSec(0)
    } catch { toast('Não foi possível acessar o microfone', true) }
  }
  useEffect(() => { if (!rec) return; const t = setInterval(() => setRecSec(Math.floor((Date.now() - rec.started) / 1000)), 500); return () => clearInterval(t) }, [rec])
  const stopRec = (cancel = false) => { if (!rec) return; (rec.mr as any)._cancel = cancel; rec.mr.stop(); setRec(null) }

  const setStatus = async (status: 'open' | 'closed') => { if (!selId) return; try { await api.put(`/conversations/${selId}`, { status }); setConvs(cs => cs.map(c => c.id === selId ? { ...c, status } : c)); if (convExtra?.id === selId) setConvExtra({ ...convExtra, status }); toast(status === 'closed' ? 'Conversa encerrada' : 'Conversa reaberta') } catch (e: any) { toast(e.message, true) } }

  const windowLeft = cur ? fmtWindow(cur.window_expires_at) : null
  const windowOpen = !!windowLeft
  const unreadTotal = convs.reduce((s, c) => s + (c.unread || 0), 0)

  // agrupamento por dia
  const grouped = useMemo(() => { const out: { label: string; items: any[] }[] = []; for (const m of msgs) { const l = dayLabel(m.created_at); if (!out.length || out[out.length - 1].label !== l) out.push({ label: l, items: [] }); out[out.length - 1].items.push(m) } return out }, [msgs])

  return <main className="main full">
    <div className="top">
      <div><h1>Conversas</h1><div className="sub">{numbers.length} número{numbers.length === 1 ? '' : 's'} · {unreadTotal} aguardando resposta</div></div>
      <div className="tools">
        {numbers.length > 0 && <Segmented value={numberId} onChange={setNumberId} options={[{ value: 'all', label: 'Todos os números' }, ...numbers.map(n => ({ value: String(n.id), label: n.label }))]} />}
        <button className="btn p" onClick={() => setNewConv(true)}><Icon name="plus" />Nova conversa</button>
      </div>
    </div>

    <div className="card inbox">
      <div className="clist">
        <div className="search">
          <input className="inp" placeholder="Buscar por nome, telefone ou e-mail" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="filt">{FILTERS.map(f => <button key={f.value} className={filter === f.value ? 'on' : ''} onClick={() => setFilter(f.value)}>{f.label}</button>)}</div>
        </div>
        <div className="scroll">
          {loadingList && convs.length === 0 ? <div className="empty"><Spinner /></div> : convs.length === 0 ? <Empty title="Nenhuma conversa">{filter === 'all' && !dSearch ? 'As conversas aparecem aqui quando alguém escrever ou quando você iniciar uma.' : 'Nada com esse filtro.'}</Empty> :
            convs.map(c => { const tags: string[] = (c.tags || []).map((t: string) => t.toLowerCase()); return <button key={c.id} className={'conv' + (c.id === selId ? ' on' : '')} onClick={() => navigate(`/conversas/${c.id}`)}>
              <Avatar name={c.name || c.phone} />
              <div>
                <div className="nm"><em>{c.name || fmtPhone(c.phone)}</em>
                  {c.pending_amount != null && <span className="tag o">PIX</span>}
                  {tags.includes('premium') ? <span className="tag">PREMIUM</span> : tags.includes('vip') ? <span className="tag">VIP</span> : null}
                  {(tags.includes('anuncio') || tags.includes('anúncio') || tags.includes('ad')) && <span className="tag b">ANÚNCIO</span>}
                  {c.status === 'closed' && <span className="tag" style={{ background: 'var(--panel3)', color: 'var(--dim)' }}>ENCERRADA</span>}
                </div>
                <div className="pv">{c.last_direction === 'out' ? 'Você: ' : ''}{c.last_preview || <span className="dim">Sem mensagens</span>}</div>
              </div>
              <div className="rt"><span className="tm">{fmtRel(c.last_message_at)}</span>{c.unread > 0 ? <span className="un">{c.unread}</span> : c.window_open ? <span className="wdot" title="Janela aberta" /> : null}</div>
            </button> })}
          {hasMore && <div className="more"><button className="btn g sm" onClick={loadMoreList}>Carregar mais</button></div>}
        </div>
      </div>

      <div className="chat">
        {!cur ? <Empty title="Selecione uma conversa">Escolha alguém na lista ou inicie uma nova conversa.</Empty> : <>
          <div className="ch">
            <Avatar name={cur.name || cur.phone} />
            <div className="who"><b>{cur.name || fmtPhone(cur.phone)}</b><span>{fmtPhone(cur.phone)} · atendido pelo {cur.number_label}</span></div>
            <div className="win">{windowOpen ? <><span className="dot" />Janela aberta · fecha em <b>{windowLeft}</b></> : <><span className="dot d" />Janela fechada · envie um template</>}</div>
            {cur.status === 'closed' ? <button className="btn sm" onClick={() => setStatus('open')}>Reabrir</button> : <ConfirmButton className="btn g sm" label="Encerrar?" onConfirm={() => setStatus('closed')}>Encerrar conversa</ConfirmButton>}
          </div>
          <div className="msgs" ref={msgsRef}>
            {loadingMsgs && <div className="day"><Spinner /></div>}
            {moreMsgs && !loadingMsgs && <button className="btn g sm loadmore" onClick={loadOlder}>Carregar mensagens anteriores</button>}
            {!loadingMsgs && msgs.length === 0 && <div className="day">Nenhuma mensagem ainda</div>}
            {grouped.map(g => <React.Fragment key={g.label}>
              <div className="day">{g.label}</div>
              {g.items.map(m => m.type === 'system' ? <div key={m.id} className="sysm">{m.body}</div> : <Bubble key={m.id} m={m} onImage={setLightbox} />)}
            </React.Fragment>)}
          </div>
          {!windowOpen ? <div className="closed"><span><Icon name="clock" size={14} /> Janela de 24h fechada. Fora dela a Meta só aceita templates aprovados.</span><button className="btn p sm" onClick={() => setTplModal(null)}><Icon name="template" size={14} />Enviar template</button></div> :
            <div className="compose">
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => onFile(e.target.files?.[0] || null)} />
              {menu && <div className="menu">
                <button onClick={() => pickFile('image', 'image/*')}><Icon name="image" size={15} />Imagem</button>
                <button onClick={() => pickFile('video', 'video/*')}><Icon name="video" size={15} />Vídeo</button>
                <button onClick={() => pickFile('audio', 'audio/*')}><Icon name="mic" size={15} />Áudio</button>
                <button onClick={() => pickFile('document', '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip')}><Icon name="file" size={15} />Documento</button>
              </div>}
              {rec ? <>
                <div className="recording"><i />Gravando · {Math.floor(recSec / 60)}:{String(recSec % 60).padStart(2, '0')}</div>
                <button className="ic" title="Cancelar" onClick={() => stopRec(true)}><Icon name="x" /></button>
                <button className="btn p" onClick={() => stopRec(false)}><Icon name="send" />Enviar áudio</button>
              </> : <>
                <button className="ic" title="Anexar" onClick={() => setMenu(m => !m)}><Icon name="plus" /></button>
                <button className="ic" title="Enviar template" onClick={() => setTplModal(null)}><Icon name="template" /></button>
                <textarea ref={taRef} className="ta" rows={1} placeholder="Escreva uma mensagem…" value={text} onChange={e => { setText(e.target.value); const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() } }} onFocus={() => setMenu(false)} />
                {canRecord && !text.trim() && <button className="ic" title="Gravar áudio" onClick={startRec}><Icon name="mic" /></button>}
                <button className="btn p" disabled={!text.trim() || sending} onClick={sendText}><Icon name="send" />Enviar</button>
              </>}
            </div>}
        </>}
      </div>

      {cur ? <ContactPanel key={cur.contact_id} conv={cur} onSendText={t => send({ type: 'text', text: t })} /> : <div className="cinfo" />}
    </div>

    {lightbox && <div className="lightbox" onClick={() => setLightbox(null)}><img src={lightbox} alt="" /></div>}
    {tplModal !== null && cur && <TemplateModal hint={tplModal || undefined} onClose={() => setTplModal(null)} onSend={async (template_id, values) => { const ok = await (async () => { try { const m = await api.post(`/conversations/${selId}/send`, { type: 'template', template_id, values }); setMsgs(ms => [...ms, m]); toast('Template enviado'); return true } catch (e: any) { toast(e.message, true); return false } })(); if (!ok) throw new Error('falha') }} />}
    {newConv && <NewConversation numbers={numbers} onClose={() => setNewConv(false)} onDone={cv => { setNewConv(false); loadList(); navigate(`/conversas/${cv.id}`) }} />}
  </main>
}

function NewConversation({ numbers, onClose, onDone }: { numbers: any[]; onClose: () => void; onDone: (cv: any) => void }) {
  const { toast } = useToast()
  const [phone, setPhone] = useState(''), [name, setName] = useState(''), [numberId, setNumberId] = useState(''), [busy, setBusy] = useState(false)
  const submit = async () => { const p = phone.replace(/\D/g, ''); if (p.length < 10) return toast('Informe o telefone com DDD', true); setBusy(true); try { onDone(await api.post('/conversations/start', { phone: p, name: name || undefined, number_id: numberId || undefined })) } catch (e: any) { toast(e.message, true) } finally { setBusy(false) } }
  return <Modal title="Nova conversa" onClose={onClose} footer={<><button className="btn g" onClick={onClose}>Cancelar</button><button className="btn p" disabled={busy} onClick={submit}>{busy ? 'Abrindo…' : 'Abrir conversa'}</button></>}>
    <Field label="Telefone" hint="Com DDI e DDD, ex: 5511999990000"><input className="inp" value={phone} onChange={e => setPhone(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && submit()} /></Field>
    <Field label="Nome (opcional)"><input className="inp" value={name} onChange={e => setName(e.target.value)} /></Field>
    <Field label="Número de envio" hint="Vazio = escolha automática"><select className="sel" value={numberId} onChange={e => setNumberId(e.target.value)}><option value="">Automático</option>{numbers.map(n => <option key={n.id} value={n.id}>{n.label} · {n.display_phone}</option>)}</select></Field>
    <p className="muted" style={{ fontSize: 12, margin: 0 }}>Se o contato nunca escreveu nas últimas 24h, a primeira mensagem precisa ser um template.</p>
  </Modal>
}
