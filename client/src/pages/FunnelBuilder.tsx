// Construtor de funil — canvas React Flow + paleta + propriedades
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Handle, Position,
  useNodesState, useEdgesState, addEdge, useReactFlow, BaseEdge, EdgeLabelRenderer, getBezierPath, MarkerType,
  type Node, type Edge, type NodeProps, type EdgeProps, type Connection
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './FunnelBuilder.css'
import { api, fmtDuration, fmtPhone, fmtDateTime, fmtRel } from '../lib/api'
import { useToast, Modal, Pill, Empty, Spinner, Icon, Segmented, Field, Toggle, ConfirmButton } from '../components/ui'

// ---------- catálogo de blocos ----------
type Cat = 'msg' | 'media' | 'flow' | 'logic' | 'end' | 'trigger'
type Block = { type: string; label: string; cat: Cat; glyph: string; icon?: string; disabled?: boolean; tip?: string; defaults: () => any }
const BLOCKS: Block[] = [
  { type: 'template', label: 'Template aprovado', cat: 'msg', glyph: 'T', defaults: () => ({ label: 'Template', template_id: null, values: {} }) },
  { type: 'text', label: 'Texto', cat: 'msg', glyph: 'Aa', defaults: () => ({ label: 'Texto', text: '' }) },
  { type: 'buttons', label: 'Botões', cat: 'msg', glyph: '▣', defaults: () => ({ label: 'Botões', body: '', buttons: [{ id: 'sim', title: 'Sim' }, { id: 'nao', title: 'Não' }], timeout_seconds: 86400 }) },
  { type: 'list', label: 'Lista', cat: 'msg', glyph: '☰', defaults: () => ({ label: 'Lista', body: '', buttonText: 'Ver opções', sections: [{ title: 'Opções', rows: [{ id: 'opcao_1', title: 'Opção 1' }] }], timeout_seconds: 86400 }) },
  { type: 'image', label: 'Imagem', cat: 'media', glyph: '▲', icon: 'image', defaults: () => ({ label: 'Imagem', media_id: null, caption: '' }) },
  { type: 'video', label: 'Vídeo', cat: 'media', glyph: '▶', icon: 'video', defaults: () => ({ label: 'Vídeo', media_id: null, caption: '' }) },
  { type: 'audio', label: 'Áudio gravado', cat: 'media', glyph: '♪', icon: 'mic', defaults: () => ({ label: 'Áudio', media_id: null }) },
  { type: 'document', label: 'Documento', cat: 'media', glyph: '▤', icon: 'file', defaults: () => ({ label: 'Documento', media_id: null, caption: '', filename: '' }) },
  { type: 'delay', label: 'Aguardar', cat: 'flow', glyph: '⏱', defaults: () => ({ label: 'Aguardar', seconds: 300 }) },
  { type: 'wait_reply', label: 'Esperar resposta', cat: 'flow', glyph: '✎', defaults: () => ({ label: 'Esperar resposta', timeout_seconds: 7200, save_as: 'resposta' }) },
  { type: 'goto_funnel', label: 'Ir para outro funil', cat: 'flow', glyph: '⇄', defaults: () => ({ label: 'Ir para funil', funnel_id: null }) },
  { type: 'condition', label: 'Condição', cat: 'logic', glyph: '?', defaults: () => ({ label: 'Condição', variable: 'resposta', op: 'contains', value: '' }) },
  { type: 'set_var', label: 'Salvar variável', cat: 'logic', glyph: '{x}', defaults: () => ({ label: 'Salvar variável', key: '', value: '', persist: true }) },
  { type: 'tag', label: 'Marcar contato', cat: 'logic', glyph: '⚑', defaults: () => ({ label: 'Tag', tag: '', remove: false }) },
  { type: 'end', label: 'Encerrar', cat: 'end', glyph: '■', defaults: () => ({ label: 'Encerrar', outcome: '' }) }
]
const CATS: { key: Cat; label: string }[] = [{ key: 'msg', label: 'Mensagens' }, { key: 'media', label: 'Mídia' }, { key: 'flow', label: 'Fluxo' }, { key: 'logic', label: 'Lógica' }]
const blockOf = (type: string): Block => BLOCKS.find(b => b.type === type) || { type, label: type === 'trigger' ? 'Gatilho' : type, cat: type === 'trigger' ? 'trigger' : 'logic', glyph: type === 'trigger' ? '⚡' : '•', defaults: () => ({}) }
const catClass = (b: Block) => b.cat === 'end' ? 'c-end' : 'c-' + b.cat

const OPS: { v: string; l: string; noValue?: boolean }[] = [
  { v: 'eq', l: 'é igual a' }, { v: 'neq', l: 'é diferente de' }, { v: 'contains', l: 'contém' }, { v: 'not_contains', l: 'não contém' },
  { v: 'starts', l: 'começa com' }, { v: 'gt', l: 'é maior que' }, { v: 'lt', l: 'é menor que' }, { v: 'exists', l: 'está preenchida', noValue: true },
  { v: 'empty', l: 'está vazia', noValue: true }, { v: 'has_tag', l: 'contato tem a tag' }, { v: 'regex', l: 'bate com a expressão (regex)' }
]
const UNITS = [{ v: 1, l: 'segundos' }, { v: 60, l: 'minutos' }, { v: 3600, l: 'horas' }, { v: 86400, l: 'dias' }]
const EMOJIS = ['😀', '😉', '😊', '🙏', '👍', '👏', '🎉', '🔥', '💚', '✅', '⚠️', '⏰', '💰', '💳', '📲', '🚀', '🎁', '😅', '🤝', '👇']
const RUN_STATUS: Record<string, { l: string; k: 'ok' | 'warn' | 'crit' | 'info' | 'dim' | 'win' }> = {
  scheduled: { l: 'Agendado', k: 'dim' }, running: { l: 'Em execução', k: 'info' }, waiting_delay: { l: 'Aguardando', k: 'warn' },
  waiting_reply: { l: 'Esperando resposta', k: 'warn' }, done: { l: 'Concluído', k: 'ok' }, cancelled: { l: 'Cancelado', k: 'dim' }, failed: { l: 'Falhou', k: 'crit' }
}

const slug = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'opcao'
const uid = (p = 'n') => p + '_' + Math.random().toString(36).slice(2, 8)
const splitSecs = (s: number) => { for (const u of [...UNITS].reverse()) if (s > 0 && s % u.v === 0) return { v: s / u.v, u: u.v }; return { v: s || 0, u: 1 } }
const highlight = (t: string) => { const parts = String(t || '').split(/(\{\{[^}]+\}\})/g); return parts.map((p, i) => /^\{\{[^}]+\}\}$/.test(p) ? <span key={i} className="var">{p}</span> : <React.Fragment key={i}>{p}</React.Fragment>) }
const tplBody = (t: any) => t?.components?.find((c: any) => c.type === 'BODY')?.text || ''
const tplHeader = (t: any) => t?.components?.find((c: any) => c.type === 'HEADER')
const tplVarIdx = (t: any) => { const s = new Set<string>(); for (const m of tplBody(t).matchAll(/\{\{(\d+)\}\}/g)) s.add(m[1]); return [...s].sort((a, b) => +a - +b) }
const fillTpl = (t: any, values: any) => tplBody(t).replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => values?.[n] || `{{${n}}}`)

// ---------- contexto compartilhado com os nós ----------
type Ctx = { templates: any[]; media: any[]; funnels: any[]; stats: Record<string, number>; description?: string; setDescription?: (v: string) => void }
const BuilderCtx = createContext<Ctx>({ templates: [], media: [], funnels: [], stats: {} })

// ---------- nó customizado ----------
function OutHandle({ id }: { id?: string }) { return <Handle type="source" position={Position.Right} id={id} /> }

function BlockNode({ id, type, data, selected }: NodeProps) {
  const d = data as any
  const b = blockOf(type as string)
  const ctx = useContext(BuilderCtx)
  const runs = ctx.stats[id] || 0
  const isTrigger = type === 'trigger'
  const title = isTrigger ? 'Gatilho' : (d.label && d.label !== b.label ? `${b.label} · ${d.label}` : b.label)
  let body: React.ReactNode = null
  let outs: React.ReactNode = <OutHandle />

  switch (type) {
    case 'trigger':
      body = <>{d.entry === 'session' ? <><b style={{ color: 'var(--mint)' }}>Cliente escreveu primeiro</b><br /><span style={{ fontSize: 11.5 }}>Janela aberta: pode começar com texto, áudio ou botões.</span></> : <><b style={{ color: 'var(--mint)' }}>Orion inicia a conversa</b><br /><span style={{ fontSize: 11.5 }}>Primeiro envio precisa ser um template aprovado.</span></>}<br /><span style={{ fontSize: 11.5 }}>As regras de disparo ficam na <b style={{ color: 'var(--mint)' }}>Automação</b>.</span></>
      break
    case 'template': {
      const t = ctx.templates.find(x => x.id === d.template_id)
      body = t ? <><div className="tpl">● {t.name} · {t.category} · {t.language}</div><div className="msg">{highlight(fillTpl(t, d.values))}</div></> : <span className="empty-hint">Selecione um template aprovado</span>
      break
    }
    case 'text':
      body = d.text ? <div className="msg">{highlight(d.text)}</div> : <span className="empty-hint">Escreva a mensagem no painel ao lado</span>
      break
    case 'buttons': case 'list': {
      const opts: { id: string; title: string }[] = type === 'buttons' ? (d.buttons || []) : (d.sections || []).flatMap((s: any) => s.rows || [])
      body = <>{d.body ? <div className="msg">{highlight(d.body)}</div> : <span className="empty-hint">Sem texto</span>}
        <div className="opts">
          {opts.map(o => <div key={o.id} className="opt" title={o.title}>{o.title || '—'}<Handle type="source" position={Position.Right} id={o.id} /></div>)}
          <div className="opt def">Sem correspondência / tempo esgotado<Handle type="source" position={Position.Right} id="default" /></div>
        </div></>
      outs = null
      break
    }
    case 'image': case 'video': case 'audio': case 'document': {
      const m = ctx.media.find(x => x.id === d.media_id)
      body = <>{m ? (type === 'image' && m.url ? <img className="thumb" src={m.url} alt="" /> : <div className="mediabox"><Icon name={b.icon || 'file'} size={16} /><span>{m.filename}</span></div>) : <span className="empty-hint">Escolha um arquivo na biblioteca</span>}
        {type === 'audio' && <div className="fn">Enviado como nota de voz</div>}
        {d.caption && <div className="fn">{highlight(d.caption)}</div>}</>
      break
    }
    case 'delay':
      body = <>Aguarda <span className="var">{fmtDuration(Number(d.seconds || 0))}</span> antes de seguir</>
      break
    case 'wait_reply':
      body = <>Aguarda até <span className="var">{fmtDuration(Number(d.timeout_seconds || 0))}</span> · salva em <span className="var">{`{{${d.save_as || 'resposta'}}}`}</span>
        <div className="opts">
          <div className="opt yes">Respondeu<Handle type="source" position={Position.Right} id="reply" /></div>
          <div className="opt no">Sem resposta<Handle type="source" position={Position.Right} id="timeout" /></div>
        </div></>
      outs = null
      break
    case 'condition': {
      const op = OPS.find(o => o.v === d.op)
      body = <>Se <span className="var">{`{{${d.variable || '?'}}}`}</span> {op?.l || d.op} {op?.noValue ? '' : <span className="var">{d.value || '…'}</span>}
        <div className="opts">
          <div className="opt yes">Sim<Handle type="source" position={Position.Right} id="yes" /></div>
          <div className="opt no">Não<Handle type="source" position={Position.Right} id="no" /></div>
        </div></>
      outs = null
      break
    }
    case 'set_var':
      body = <><span className="var">{`{{${d.key || '?'}}}`}</span> = {d.value ? highlight(d.value) : <span className="empty-hint">valor</span>}{d.persist === false ? <div className="fn">Só nesta execução</div> : <div className="fn">Fica salvo no contato</div>}</>
      break
    case 'tag':
      body = <>{d.remove ? 'Remove a tag' : 'Adiciona a tag'} <span className="var">{d.tag || '?'}</span></>
      break
    case 'goto_funnel': {
      const f = ctx.funnels.find(x => x.id === d.funnel_id)
      body = f ? <>Continua em <span className="var">{f.name}</span></> : <span className="empty-hint">Escolha o funil de destino</span>
      outs = null
      break
    }
    case 'end':
      body = d.outcome ? <>Encerra · marca <span className="var">{d.outcome}</span></> : 'Encerra o funil'
      outs = null
      break
  }

  return <div className={`node n-${b.cat}${selected ? ' sel' : ''}`}>
    {!isTrigger && <Handle type="target" position={Position.Left} />}
    <div className="nh"><i className={catClass(b)}>{b.glyph}</i><span className="t">{title}</span>{runs > 0 && <span className="runs" title="Execuções neste bloco">{runs}</span>}</div>
    <div className="nb">{body}</div>
    {outs}
  </div>
}
const nodeTypes = Object.fromEntries(['trigger', ...BLOCKS.map(b => b.type)].map(t => [t, BlockNode]))

// ---------- edge com botão de remover ----------
function DelEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style }: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
    {selected && <EdgeLabelRenderer><div style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`, pointerEvents: 'all' }} className="nodrag nopan">
      <button className="edge-del" title="Remover conexão" onClick={() => deleteElements({ edges: [{ id }] })}><Icon name="x" size={11} /></button>
    </div></EdgeLabelRenderer>}
  </>
}
const edgeTypes = { del: DelEdge }

// ---------- entrada com chips de variáveis ----------
function VarInput({ value, onChange, multiline, placeholder, vars, emoji, max }: { value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; vars: any[]; emoji?: boolean; max?: number }) {
  const ref = useRef<any>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const insert = (s: string) => {
    const el = ref.current; const v = value || ''
    const st = el?.selectionStart ?? v.length, en = el?.selectionEnd ?? v.length
    const nv = v.slice(0, st) + s + v.slice(en)
    onChange(nv)
    requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = st + s.length } })
  }
  const len = (value || '').length
  return <div>
    {multiline ? <textarea ref={ref} className="ta" value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      : <input ref={ref} className="inp" value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
    {(max || emoji) && <div className="row between" style={{ marginTop: 3 }}>
      {emoji ? <button className="btn g sm" type="button" onClick={() => setShowEmoji(s => !s)}>😊 Emoji</button> : <span />}
      {max && <span className={'fb-count' + (len > max ? ' over' : '')}>{len}/{max}</span>}
    </div>}
    {showEmoji && <div className="fb-emoji">{EMOJIS.map(e => <button key={e} type="button" onClick={() => insert(e)}>{e}</button>)}</div>}
    <div className="chips" style={{ marginTop: 6 }}>{vars.map(v => <span key={v.key} className="chip" title={v.label + (v.example ? ' · ex.: ' + v.example : '')} onClick={() => insert(`{{${v.key}}}`)}>{`{{${v.key}}}`}</span>)}</div>
  </div>
}

function DurationInput({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const [st, setSt] = useState(() => splitSecs(seconds))
  useEffect(() => { const s = splitSecs(seconds); if (s.v * s.u !== st.v * st.u) setSt(s) }, [seconds])
  const set = (v: number, u: number) => { setSt({ v, u }); onChange(Math.max(0, Math.round(v * u))) }
  return <div className="row">
    <input className="inp" type="number" min={0} value={st.v} onChange={e => set(Number(e.target.value), st.u)} style={{ width: 90 }} />
    <select className="sel" value={st.u} onChange={e => set(st.v, Number(e.target.value))}>{UNITS.map(u => <option key={u.v} value={u.v}>{u.l}</option>)}</select>
  </div>
}

// ---------- biblioteca de mídia ----------
function MediaLibrary({ kind, selected, onPick, onClose, media, reload }: { kind: string; selected: any; onPick: (m: any) => void; onClose: () => void; media: any[]; reload: () => void }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const list = media.filter(m => !kind || m.kind === kind)
  const accept = { image: 'image/*', video: 'video/*', audio: 'audio/*', document: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip' }[kind] || '*/*'
  const up = async (f: File) => {
    setBusy(true)
    try { const m = await api.upload('/media', f, { kind }); toast('Arquivo enviado'); reload(); onPick(m) } catch (e: any) { toast(e.message, true) } finally { setBusy(false) }
  }
  const icon = { image: 'image', video: 'video', audio: 'mic', document: 'file' }[kind] || 'file'
  return <Modal title={'Biblioteca de mídia · ' + ({ image: 'Imagens', video: 'Vídeos', audio: 'Áudios', document: 'Documentos' }[kind] || 'Arquivos')} onClose={onClose} size="lg">
    <div className="mlib-up" onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) up(f) }}>
      {busy ? <Spinner /> : <><Icon name="upload" /> Arraste um arquivo aqui ou clique para enviar</>}
      {kind === 'audio' && <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>O áudio é convertido para nota de voz (OGG/Opus), como se fosse gravado no WhatsApp.</div>}
      <input ref={fileRef} type="file" accept={accept} hidden onChange={e => { const f = e.target.files?.[0]; if (f) up(f); e.target.value = '' }} />
    </div>
    {list.length === 0 ? <Empty title="Nenhum arquivo enviado ainda">Envie o primeiro arquivo acima.</Empty> :
      <div className="mlib">{list.map(m => <div key={m.id} className={'it' + (selected === m.id ? ' on' : '')} onClick={() => onPick(m)}>
        {m.kind === 'image' && m.url ? <img src={m.url} alt="" /> : <div className="ph"><Icon name={icon} size={26} /></div>}
        <div className="nm" title={m.filename}>{m.filename}</div>
        <div className="sz">{(m.size / 1024).toFixed(0)} KB</div>
      </div>)}</div>}
  </Modal>
}

// ---------- painel de propriedades ----------
function Props({ node, update, vars, ctx, reloadMedia, onDuplicate, onRemove }: { node: Node; update: (patch: any) => void; vars: any[]; ctx: Ctx; reloadMedia: () => void; onDuplicate: () => void; onRemove: () => void }) {
  const d = node.data as any
  const b = blockOf(node.type as string)
  const [lib, setLib] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  const isTrigger = node.type === 'trigger'

  // prévia renderizada via API (template / texto)
  const previewSrc = node.type === 'template' ? fillTpl(ctx.templates.find(t => t.id === d.template_id), d.values) : node.type === 'text' ? d.text : ''
  useEffect(() => {
    if (!previewSrc) { setPreview(''); return }
    const t = setTimeout(() => api.post('/tools/render', { text: previewSrc }).then(r => setPreview(r.text)).catch(() => setPreview(previewSrc)), 400)
    return () => clearTimeout(t)
  }, [previewSrc])

  const opts = (list: any[], onList: (l: any[]) => void, maxTitle = 20) => <>
    {list.map((o, i) => <div key={i} className="opt-row">
      <button className="btn g icon sm" type="button" title="Mover para cima" disabled={i === 0} onClick={() => { const l = [...list]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; onList(l) }}>↑</button>
      <input className="inp" value={o.title} maxLength={maxTitle} placeholder="Título" onChange={e => { const l = [...list]; l[i] = { ...o, title: e.target.value, id: o.custom ? o.id : slug(e.target.value) || o.id, custom: o.custom }; onList(l) }} />
      <span className="id" title={'id: ' + o.id}>{o.id}</span>
      <button className="btn g icon sm" type="button" title="Remover" onClick={() => onList(list.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
    </div>)}
  </>

  let body: React.ReactNode
  switch (node.type) {
    case 'trigger':
      body = <>
        <Field label="Quem começa a conversa" hint={d.entry === 'session' ? 'Use para Lead do anúncio ou Novo contato: o cliente já escreveu, a janela de 24h (72h vindo de anúncio) está aberta e qualquer bloco pode ser o primeiro.' : 'Use para Pix gerado, compra aprovada, campanhas: o cliente não escreveu, então a Meta só aceita template aprovado como primeiro envio.'}>
          <select className="sel" value={d.entry || 'template'} onChange={e => update({ entry: e.target.value })}>
            <option value="template">Orion inicia (precisa de template)</option>
            <option value="session">Cliente escreveu primeiro (janela aberta)</option>
          </select>
        </Field>
        <Field label="Descrição do funil" hint="Aparece na lista de funis."><textarea className="ta" style={{ minHeight: 70 }} value={ctx.description || ''} placeholder="Para que serve este funil?" onChange={e => ctx.setDescription?.(e.target.value)} /></Field>
        <div className="fb-info">Quem decide <b>quando</b> o funil dispara (Pix gerado, 7 minutos de espera, valor mínimo, cooldown, horário) é a <b>Automação</b>. Conecte a saída verde ao primeiro bloco.</div>
      </>
      break
    case 'template': {
      const approved = ctx.templates.filter(t => t.status === 'APPROVED')
      const t = ctx.templates.find(x => x.id === d.template_id)
      const idx = tplVarIdx(t)
      const header = tplHeader(t)
      const headerMedia = header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format)
      const hk = headerMedia ? header.format.toLowerCase() : null
      const hm = ctx.media.find(m => m.id === d.header_media_id)
      body = <>
        <Field label="Template da Meta" hint={approved.length ? 'Só templates aprovados aparecem aqui.' : 'Nenhum template aprovado. Crie e aguarde a aprovação na página Templates.'}>
          <select className="sel" value={d.template_id || ''} onChange={e => { const nt = ctx.templates.find(x => x.id === Number(e.target.value)); update({ template_id: nt ? nt.id : null, values: {}, header_media_id: null, label: nt ? nt.name : 'Template' }) }}>
            <option value="">Selecione…</option>
            {approved.map(x => <option key={x.id} value={x.id}>{x.name} · {x.category} · {x.language}</option>)}
          </select>
        </Field>
        {t && <>
          <Field label="Corpo"><div className="fb-preview" style={{ color: 'var(--muted)' }}>{highlight(tplBody(t))}</div></Field>
          {idx.length > 0 && <div className="fb-section">Variáveis do template</div>}
          {idx.map(n => {
            const name = (t.variables || []).find((v: any) => String(v.index) === n)?.name
            return <Field key={n} label={name ? `{{${n}}} · ${name}` : `Variável {{${n}}}`}>
              <VarInput value={d.values?.[n] || ''} vars={vars} placeholder="Texto fixo ou {{variavel}}" onChange={v => update({ values: { ...(d.values || {}), [n]: v } })} />
            </Field>
          })}
          {headerMedia && <Field label={'Mídia do cabeçalho (' + header.format.toLowerCase() + ')'} hint="O template exige um arquivo no cabeçalho.">
            <div className="fb-mediasel" onClick={() => setLib(hk)}>
              {hm?.kind === 'image' && hm.url ? <img src={hm.url} alt="" /> : <div className="ph"><Icon name={{ image: 'image', video: 'video', document: 'file' }[hk!] || 'file'} /></div>}
              <div style={{ minWidth: 0 }}><div className="nm">{hm ? hm.filename : 'Escolher arquivo…'}</div>{hm && <div className="sz">{(hm.size / 1024).toFixed(0)} KB</div>}</div>
            </div>
          </Field>}
          <Field label="Prévia com valores de exemplo"><div className={'fb-preview' + (preview ? '' : ' dim')}>{preview || 'Preenchendo…'}</div></Field>
        </>}
        {lib && <MediaLibrary kind={lib} selected={d.header_media_id} media={ctx.media} reload={reloadMedia} onClose={() => setLib(null)} onPick={m => { update({ header_media_id: m.id }); setLib(null) }} />}
      </>
      break
    }
    case 'text':
      body = <>
        <Field label="Mensagem"><VarInput multiline value={d.text} vars={vars} emoji max={4096} placeholder="Escreva a mensagem. Use {{primeiro_nome}} para personalizar." onChange={v => update({ text: v })} /></Field>
        <Field label="Prévia"><div className={'fb-preview' + (preview ? '' : ' dim')}>{preview || 'A prévia aparece aqui'}</div></Field>
        <Toggle on={!!d.preview_url} onChange={v => update({ preview_url: v })} label="Mostrar prévia de links" />
        <div className="fb-info" style={{ marginTop: 10 }}><b>Código Pix:</b> a Meta não tem botão de copiar para textos longos (o botão "Copiar código" só aceita até 15 caracteres, em template). Mande o código sozinho numa mensagem só com <code>{'{{pix_copia_cola}}'}</code>: o cliente segura e copia, como nos bancos.</div>
      </>
      break
    case 'buttons':
      body = <>
        <Field label="Cabeçalho (opcional)"><input className="inp" value={d.header || ''} maxLength={60} onChange={e => update({ header: e.target.value })} /></Field>
        <Field label="Texto"><VarInput multiline value={d.body} vars={vars} emoji max={1024} onChange={v => update({ body: v })} /></Field>
        <Field label="Rodapé (opcional)"><input className="inp" value={d.footer || ''} maxLength={60} onChange={e => update({ footer: e.target.value })} /></Field>
        <div className="fb-section">Botões (até 3, 20 caracteres) {(d.buttons || []).length < 3 && <button className="btn g sm" onClick={() => update({ buttons: [...(d.buttons || []), { id: uid('btn'), title: '', custom: true }] })}><Icon name="plus" size={12} />Botão</button>}</div>
        {opts(d.buttons || [], l => update({ buttons: l }))}
        <Field label="Tempo máximo esperando a resposta" hint="Passado esse tempo, segue pela saída “Sem correspondência”."><DurationInput seconds={d.timeout_seconds ?? 86400} onChange={s => update({ timeout_seconds: s })} /></Field>
      </>
      break
    case 'list': {
      const secs: any[] = d.sections || []
      const setSec = (i: number, patch: any) => update({ sections: secs.map((s, j) => j === i ? { ...s, ...patch } : s) })
      const total = secs.reduce((n, s) => n + (s.rows || []).length, 0)
      body = <>
        <Field label="Cabeçalho (opcional)"><input className="inp" value={d.header || ''} maxLength={60} onChange={e => update({ header: e.target.value })} /></Field>
        <Field label="Texto"><VarInput multiline value={d.body} vars={vars} emoji max={1024} onChange={v => update({ body: v })} /></Field>
        <Field label="Rodapé (opcional)"><input className="inp" value={d.footer || ''} maxLength={60} onChange={e => update({ footer: e.target.value })} /></Field>
        <Field label="Texto do botão que abre a lista"><input className="inp" value={d.buttonText || ''} maxLength={20} onChange={e => update({ buttonText: e.target.value })} /></Field>
        {secs.map((s, i) => <div key={i} style={{ marginBottom: 10 }}>
          <div className="fb-section">Seção {i + 1}<div className="row" style={{ gap: 4 }}>{total < 10 && <button className="btn g sm" onClick={() => setSec(i, { rows: [...(s.rows || []), { id: uid('row'), title: '', custom: true }] })}><Icon name="plus" size={12} />Opção</button>}{secs.length > 1 && <button className="btn g sm icon" onClick={() => update({ sections: secs.filter((_, j) => j !== i) })}><Icon name="x" size={12} /></button>}</div></div>
          <input className="inp" style={{ marginBottom: 6 }} value={s.title || ''} maxLength={24} placeholder="Título da seção" onChange={e => setSec(i, { title: e.target.value })} />
          {opts(s.rows || [], l => setSec(i, { rows: l }), 24)}
        </div>)}
        <button className="btn sm" onClick={() => update({ sections: [...secs, { title: '', rows: [] }] })}><Icon name="plus" size={12} />Seção</button>
        <div style={{ height: 12 }} />
        <Field label="Tempo máximo esperando a resposta"><DurationInput seconds={d.timeout_seconds ?? 86400} onChange={s => update({ timeout_seconds: s })} /></Field>
      </>
      break
    }
    case 'image': case 'video': case 'audio': case 'document': {
      const m = ctx.media.find(x => x.id === d.media_id)
      body = <>
        <Field label="Arquivo">
          <div className="fb-mediasel" onClick={() => setLib(node.type as string)}>
            {m?.kind === 'image' && m.url ? <img src={m.url} alt="" /> : <div className="ph"><Icon name={b.icon || 'file'} /></div>}
            <div style={{ minWidth: 0 }}><div className="nm">{m ? m.filename : 'Escolher na biblioteca…'}</div>{m && <div className="sz">{(m.size / 1024).toFixed(0)} KB · {m.mime}</div>}</div>
          </div>
        </Field>
        {node.type === 'audio' && <div className="fb-info">O áudio é convertido para nota de voz (OGG/Opus) e chega como se tivesse sido gravado na hora.</div>}
        {node.type === 'document' && <Field label="Nome do arquivo exibido"><input className="inp" value={d.filename || ''} placeholder={m?.filename || 'arquivo.pdf'} onChange={e => update({ filename: e.target.value })} /></Field>}
        {node.type !== 'audio' && <Field label="Legenda (opcional)"><VarInput multiline value={d.caption} vars={vars} emoji max={1024} onChange={v => update({ caption: v })} /></Field>}
        {lib && <MediaLibrary kind={lib} selected={d.media_id} media={ctx.media} reload={reloadMedia} onClose={() => setLib(null)} onPick={mm => { update({ media_id: mm.id, label: mm.filename }); setLib(null) }} />}
      </>
      break
    }
    case 'delay':
      body = <Field label="Aguardar por" hint="O funil pausa e continua sozinho depois desse tempo. Respeita o horário de silêncio das configurações."><DurationInput seconds={d.seconds ?? 300} onChange={s => update({ seconds: s })} /></Field>
      break
    case 'wait_reply':
      body = <>
        <Field label="Esperar no máximo" hint="Sem resposta nesse prazo, segue pela saída “Sem resposta”."><DurationInput seconds={d.timeout_seconds ?? 7200} onChange={s => update({ timeout_seconds: s })} /></Field>
        <Field label="Salvar a resposta em" hint="Depois use {{nome_da_variavel}} em qualquer bloco ou numa condição."><input className="inp" value={d.save_as || ''} placeholder="resposta" onChange={e => update({ save_as: slug(e.target.value) })} /></Field>
      </>
      break
    case 'condition': {
      const op = OPS.find(o => o.v === d.op)
      body = <>
        <Field label="Variável" hint="Escolha uma ou digite o nome de uma variável salva no funil.">
          <input className="inp" list="fb-vars" value={d.variable || ''} onChange={e => update({ variable: e.target.value.replace(/[{}]/g, '') })} />
          <datalist id="fb-vars">{vars.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}<option value="tags">Tags do contato</option></datalist>
        </Field>
        <Field label="Operador"><select className="sel" value={d.op || 'contains'} onChange={e => update({ op: e.target.value })}>{OPS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></Field>
        {!op?.noValue && <Field label="Valor" hint={d.op === 'contains' ? 'Ex.: “sim” bate com “Sim, quero!”. Não diferencia maiúsculas.' : undefined}><VarInput value={d.value} vars={vars} onChange={v => update({ value: v })} /></Field>}
      </>
      break
    }
    case 'set_var':
      body = <>
        <Field label="Nome da variável"><input className="inp" value={d.key || ''} placeholder="ex.: interesse" onChange={e => update({ key: slug(e.target.value) })} /></Field>
        <Field label="Valor"><VarInput value={d.value} vars={vars} onChange={v => update({ value: v })} /></Field>
        <Toggle on={d.persist !== false} onChange={v => update({ persist: v })} label="Guardar no contato (fica disponível em funis futuros)" />
      </>
      break
    case 'tag':
      body = <>
        <Field label="Tag"><input className="inp" value={d.tag || ''} placeholder="ex.: interessado" onChange={e => update({ tag: e.target.value })} /></Field>
        <Toggle on={!!d.remove} onChange={v => update({ remove: v })} label="Remover a tag em vez de adicionar" />
      </>
      break
    case 'goto_funnel':
      body = <Field label="Funil de destino" hint="Esta execução termina e uma nova começa no funil escolhido, com as mesmas variáveis.">
        <select className="sel" value={d.funnel_id || ''} onChange={e => update({ funnel_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Selecione…</option>
          {ctx.funnels.filter(f => f.status === 'published').map(f => <option key={f.id} value={f.id}>{f.name} · v{f.version}</option>)}
        </select>
      </Field>
      break
    case 'end':
      body = <Field label="Resultado (opcional)" hint="Um rótulo para você entender como a conversa terminou nas execuções."><input className="inp" value={d.outcome || ''} placeholder="ex.: pagou, sem interesse" onChange={e => update({ outcome: e.target.value })} /></Field>
      break
  }

  return <>
    <h4><i className={catClass(b)}>{b.glyph}</i>{isTrigger ? 'Gatilho' : b.label}</h4>
    {!isTrigger && <Field label="Nome do bloco" hint="Só para você se achar no canvas."><input className="inp" value={d.label || ''} onChange={e => update({ label: e.target.value })} /></Field>}
    {body}
    {!isTrigger && <div className="actions">
      <button className="btn sm" onClick={onDuplicate}><Icon name="copy" size={13} />Duplicar bloco</button>
      <ConfirmButton className="btn sm danger" label="Remover?" onConfirm={onRemove}><Icon name="trash" size={13} />Remover bloco</ConfirmButton>
    </div>}
  </>
}

// ---------- página ----------
function Builder() {
  const { id } = useParams()
  const nav = useNavigate()
  const { toast } = useToast()
  const rf = useReactFlow()
  const wrapRef = useRef<HTMLDivElement>(null)

  const [funnel, setFunnel] = useState<any>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [errors, setErrors] = useState<string[]>([])
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [tab, setTab] = useState<'edit' | 'runs'>('edit')
  const [templates, setTemplates] = useState<any[]>([])
  const [media, setMedia] = useState<any[]>([])
  const [funnels, setFunnels] = useState<any[]>([])
  const [vars, setVars] = useState<any[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const [runs, setRuns] = useState<any[] | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [dropping, setDropping] = useState(false)
  const loaded = useRef(false)
  const dirty = useRef(false)
  const lastSaved = useRef('')
  const saveTimer = useRef<any>(null)

  const reloadMedia = useCallback(() => api.get('/media').then(setMedia).catch(() => {}), [])

  useEffect(() => {
    loaded.current = false
    api.get(`/funnels/${id}`).then(f => {
      setFunnel(f); setErrors(f.errors || [])
      const ns = (f.nodes || []).map((n: any) => ({ ...n, type: n.type || 'text', deletable: n.type !== 'trigger', data: n.data || {} }))
      const es = (f.edges || []).map((e: any) => ({ ...e, type: 'del', markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--line2)' } }))
      setNodes(ns); setEdges(es)
      lastSaved.current = JSON.stringify({ n: cleanNodes(ns), e: cleanEdges(es), name: f.name, description: f.description })
      const st: Record<string, number> = {}
      for (const s of f.node_stats || []) if (s.current_node) st[s.current_node] = (st[s.current_node] || 0) + Number(s.c || 0)
      setStats(st)
      if (f.viewport?.zoom) setTimeout(() => rf.setViewport(f.viewport), 0); else setTimeout(() => rf.fitView({ padding: .3, maxZoom: 1 }), 0)
      setTimeout(() => { loaded.current = true }, 50)
    }).catch(e => { toast(e.message, true); nav('/funis') })
    api.get('/templates').then(setTemplates).catch(() => {})
    reloadMedia()
    api.get('/funnels').then(setFunnels).catch(() => {})
    api.get('/variables').then(setVars).catch(() => {})
  }, [id])

  // ---- salvar ----
  const cleanNodes = (ns: Node[]) => ns.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data }))
  const cleanEdges = (es: Edge[]) => es.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || undefined, targetHandle: e.targetHandle || undefined }))
  const save = useCallback(async (extra: any = {}) => {
    if (!funnel) return null
    clearTimeout(saveTimer.current)
    setSaveState('saving')
    try {
      const r = await api.put(`/funnels/${id}`, { name: funnel.name, description: funnel.description, nodes: cleanNodes(nodes), edges: cleanEdges(edges), viewport: rf.getViewport(), ...extra })
      setErrors(r.errors || []); dirty.current = false; setSaveState('saved')
      setFunnel((f: any) => ({ ...f, updated_at: r.updated_at }))
      return r
    } catch (e: any) { toast('Erro ao salvar: ' + e.message, true); setSaveState('dirty'); return null }
  }, [funnel, id, nodes, edges])

  useEffect(() => {
    if (!loaded.current) return
    const snap = JSON.stringify({ n: cleanNodes(nodes), e: cleanEdges(edges), name: funnel?.name, description: funnel?.description })
    if (snap === lastSaved.current) return
    lastSaved.current = snap
    dirty.current = true; setSaveState('dirty')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(), 1500)
    return () => clearTimeout(saveTimer.current)
  }, [nodes, edges, funnel?.name, funnel?.description])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [save])

  // ---- publicar / testar ----
  const publish = async () => {
    const r = await save(); if (!r) return
    try { const f = await api.post(`/funnels/${id}/publish`); setFunnel((x: any) => ({ ...x, status: f.status, version: f.version })); setErrors([]); toast(`Funil publicado (v${f.version})`) }
    catch (e: any) { if (e.errors) { setErrors(e.errors); toast('Corrija os erros antes de publicar', true) } else toast(e.message, true) }
  }
  const test = async () => {
    const phone = testPhone.replace(/\D/g, ''); if (phone.length < 10) return toast('Informe o telefone com DDD', true)
    await save()
    try { await api.post(`/funnels/${id}/test`, { phone: phone.startsWith('55') ? phone : '55' + phone, name: 'Teste' }); toast('Execução de teste iniciada. Acompanhe em Execuções.'); setTestOpen(false) }
    catch (e: any) { toast(e.message, true) }
  }
  const loadRuns = () => api.get(`/funnels/${id}/runs`).then(setRuns).catch(e => toast(e.message, true))
  useEffect(() => { if (tab === 'runs') { setRuns(null); loadRuns() } }, [tab])

  // ---- edição de nós ----
  const addBlock = useCallback((type: string, pos?: { x: number; y: number }) => {
    const b = blockOf(type); if (b.disabled) return
    let position = pos
    if (!position && wrapRef.current) { const r = wrapRef.current.getBoundingClientRect(); position = rf.screenToFlowPosition({ x: r.left + r.width / 2 - 116 + (Math.random() * 40 - 20), y: r.top + r.height / 2 - 60 + (Math.random() * 40 - 20) }) }
    const n: Node = { id: uid(type), type, position: position || { x: 100, y: 100 }, data: b.defaults(), selected: true }
    setNodes(ns => [...ns.map(x => ({ ...x, selected: false })), n])
  }, [rf])
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDropping(false)
    const type = e.dataTransfer.getData('application/orion-block'); if (!type) return
    addBlock(type, rf.screenToFlowPosition({ x: e.clientX - 116, y: e.clientY - 20 }))
  }
  const onConnect = useCallback((c: Connection) => setEdges(es => addEdge({ ...c, id: uid('e'), type: 'del', markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--line2)' } }, es.filter(e => !(e.source === c.source && (e.sourceHandle || null) === (c.sourceHandle || null))))), [])
  const selected = useMemo(() => nodes.find(n => n.selected), [nodes])
  const selIds = useMemo(() => new Set(nodes.filter(n => n.selected).map(n => n.id)), [nodes])
  const viewEdges = useMemo(() => edges.map(e => ({ ...e, animated: selIds.has(e.source) || selIds.has(e.target) })), [edges, selIds])
  const updateNode = useCallback((nid: string, patch: any) => setNodes(ns => ns.map(n => n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)), [])
  const duplicateNode = (n: Node) => { const c: Node = { ...n, id: uid(n.type as string), position: { x: n.position.x + 40, y: n.position.y + 40 }, data: JSON.parse(JSON.stringify(n.data)), selected: true }; setNodes(ns => [...ns.map(x => ({ ...x, selected: false })), c]) }
  const removeNode = (n: Node) => rf.deleteElements({ nodes: [{ id: n.id }] })

  // primeiro bloco após o gatilho precisa ser template
  const needsTemplate = useMemo(() => {
    const trig = nodes.find(n => n.type === 'trigger'); if (!trig) return false
    if ((trig.data as any)?.entry === 'session') return false
    let cur: Node | undefined = trig; let guard = 0
    while (cur && guard++ < 12) {
      const e = edges.find(x => x.source === cur!.id && (!x.sourceHandle || x.sourceHandle === 'default' || x.sourceHandle === 'yes'))
      const nx = e ? nodes.find(n => n.id === e.target) : undefined
      if (!nx) return cur === trig ? false : true
      if (nx.type === 'template') return false
      if (!['condition', 'set_var', 'tag', 'delay'].includes(nx.type as string)) return true
      cur = nx
    }
    return true
  }, [nodes, edges])

  const ctx: Ctx = useMemo(() => ({ templates, media, funnels, stats }), [templates, media, funnels, stats])
  if (!funnel) return <main className="main full"><div className="empty"><Spinner /></div></main>

  const st = { draft: { l: 'Rascunho', k: 'dim' }, published: { l: 'Publicado', k: 'ok' }, archived: { l: 'Arquivado', k: 'warn' } }[funnel.status as string] || { l: funnel.status, k: 'dim' }

  return <main className="main full">
    <div className="top fb-top">
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <button className="btn g icon" title="Voltar para a lista" onClick={() => nav('/funis')}><Icon name="reply" /></button>
        <div style={{ minWidth: 0 }}>
          <input className="fb-name" value={funnel.name} onChange={e => setFunnel((f: any) => ({ ...f, name: e.target.value }))} onBlur={() => save()} />
          <div className="sub row" style={{ gap: 8 }}>
            <Pill kind={st.k as any}>{st.l}</Pill><span className="mono">v{funnel.version}</span>
            <span className={'fb-save' + (saveState === 'saved' ? ' on' : '')}>{saveState === 'saving' ? <><Spinner /> Salvando…</> : saveState === 'dirty' ? 'Alterações pendentes' : <><Icon name="check" size={13} /> Salvo {fmtRel(funnel.updated_at)}</>}</span>
          </div>
        </div>
      </div>
      <div className="tools">
        <Segmented<'edit' | 'runs'> value={tab} onChange={setTab} options={[{ value: 'edit', label: 'Editar' }, { value: 'runs', label: 'Execuções' }]} />
        <button className="btn" onClick={() => setTestOpen(true)}><Icon name="play" />Testar no meu número</button>
        <button className="btn" onClick={() => save()} disabled={saveState === 'saving'} title="Ctrl/Cmd + S"><Icon name="check" />Salvar</button>
        <button className="btn p" onClick={publish}><Icon name="upload" />Publicar</button>
      </div>
    </div>

    {errors.length > 0 && tab === 'edit' && <div className="fb-errors"><b>Antes de publicar, corrija:</b>{errors.map((e, i) => <span key={i}>• {e}</span>)}</div>}

    {tab === 'runs' ? <div className="fb-runs">
      <div className="row between" style={{ marginBottom: 12 }}><h2>Execuções recentes</h2><button className="btn sm" onClick={loadRuns}><Icon name="refresh" size={13} />Atualizar</button></div>
      {runs === null ? <div className="empty"><Spinner /></div> : runs.length === 0 ? <Empty title="Nenhuma execução ainda">Quando uma automação ou campanha disparar este funil, cada contato aparece aqui. Use “Testar no meu número” para ver funcionando.</Empty> :
        <table><thead><tr><th>Contato</th><th>Status</th><th>Bloco atual</th><th>Respondeu</th><th>Converteu</th><th>Criado</th><th /></tr></thead><tbody>
          {runs.map(r => { const s = RUN_STATUS[r.status] || { l: r.status, k: 'dim' }; const n = nodes.find(x => x.id === r.current_node); const nb = n ? blockOf(n.type as string) : null
            return <tr key={r.id}>
              <td><div>{r.name || 'Sem nome'}</div><div className="mono dim" style={{ fontSize: 11.5 }}>{fmtPhone(r.phone)}</div></td>
              <td><Pill kind={s.k}>{s.l}</Pill>{r.last_error && <div className="dim" style={{ fontSize: 11 }}>{r.last_error}</div>}</td>
              <td>{nb ? <span className="row" style={{ gap: 6 }}><i className={'blk-i ' + catClass(nb)} style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-block' }} />{(n!.data as any).label || nb.label}</span> : <span className="dim">—</span>}</td>
              <td>{r.replied ? <Pill kind="ok">Sim</Pill> : <span className="dim">Não</span>}</td>
              <td>{r.converted ? <Pill kind="win">Sim</Pill> : <span className="dim">Não</span>}</td>
              <td className="m">{fmtDateTime(r.created_at)}</td>
              <td className="r">{!['done', 'cancelled', 'failed'].includes(r.status) && <ConfirmButton className="btn g sm" label="Cancelar?" onConfirm={() => api.post(`/runs/${r.id}/cancel`).then(() => { toast('Execução cancelada'); loadRuns() }).catch(e => toast(e.message, true))}>Cancelar</ConfirmButton>}</td>
            </tr> })}
        </tbody></table>}
    </div> :

    <div className={'fb' + (selected ? ' has-props' : '')}>
      <div className="fb-blocks">
        {CATS.map(c => <React.Fragment key={c.key}>
          <div className="lbl">{c.label}</div>
          {BLOCKS.filter(b => b.cat === c.key || (c.key === 'logic' && b.cat === 'end')).map(b => <div key={b.type} className={'blk' + (b.disabled ? ' dis' : '')} title={b.disabled ? b.tip : 'Arraste para o canvas ou clique para adicionar'}
            draggable={!b.disabled} onDragStart={e => { e.dataTransfer.setData('application/orion-block', b.type); e.dataTransfer.effectAllowed = 'move' }} onClick={() => addBlock(b.type)}>
            <i className={catClass(b)}>{b.glyph}</i>{b.label}{b.disabled && <span className="sub">sem suporte</span>}
          </div>)}
        </React.Fragment>)}
        <div className="fb-tip">Arraste um bloco para o canvas ou clique nele. Ligue a bolinha verde de um bloco à entrada cinza do próximo. <span className="kbd">Delete</span> remove, <span className="kbd">Ctrl+S</span> salva.</div>
      </div>

      <div ref={wrapRef} className={'fb-canvas' + (dropping ? ' drop' : '')} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!dropping) setDropping(true) }} onDragLeave={() => setDropping(false)} onDrop={onDrop}>
        {dropping && <div className="fb-drop-hint"><span>Solte aqui para adicionar o bloco</span></div>}
        <BuilderCtx.Provider value={ctx}>
          <ReactFlow nodes={nodes} edges={viewEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            deleteKeyCode={['Delete', 'Backspace']} multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            onMoveEnd={() => { if (loaded.current) { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => save(), 1500) } }}
            fitView={!funnel.viewport?.zoom} minZoom={.2} maxZoom={1.6} snapToGrid snapGrid={[11, 11]} proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: 'del' }} connectionLineStyle={{ stroke: 'var(--green)' }}>
            <Background variant={BackgroundVariant.Dots} color="#1c3226" gap={22} size={1.2} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={n => ({ msg: '#2ecc71', media: '#5ab4ff', flow: '#f5b642', logic: '#c58bff', end: '#ef5b5b', trigger: '#c7f76a' } as any)[blockOf(n.type as string).cat]} maskColor="rgba(10,21,17,.6)" />
          </ReactFlow>
        </BuilderCtx.Provider>
      </div>

      {selected && <div className="fb-props">
        {needsTemplate && <div className="fb-warn"><b>Primeiro envio precisa ser um Template</b>Fora da janela de 24h a Meta só aceita template aprovado. Se o cliente escreveu primeiro, mude "Quem começa a conversa" no bloco Gatilho.</div>}
        <Props key={selected.id} node={selected} ctx={{ ...ctx, description: funnel.description, setDescription: (v: string) => setFunnel((f: any) => ({ ...f, description: v })) }} vars={vars} reloadMedia={reloadMedia} update={p => updateNode(selected.id, p)} onDuplicate={() => duplicateNode(selected)} onRemove={() => removeNode(selected)} />
      </div>}
    </div>}

    {testOpen && <Modal title="Testar no meu número" onClose={() => setTestOpen(false)}
      footer={<><button className="btn" onClick={() => setTestOpen(false)}>Cancelar</button><button className="btn p" onClick={test}><Icon name="play" />Iniciar teste</button></>}>
      <Field label="Telefone (com DDD)" hint="Cria uma venda de teste (Pix pendente de R$ 49,90) e roda o funil agora, sem esperar a automação."><input className="inp" autoFocus placeholder="11 99999-0000" value={testPhone} onChange={e => setTestPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && test()} /></Field>
      {errors.length > 0 && <div className="fb-warn">O funil tem pendências de validação; o teste pode falhar no bloco com problema.</div>}
    </Modal>}
  </main>
}

export default function FunnelBuilder() { return <ReactFlowProvider><Builder /></ReactFlowProvider> }
