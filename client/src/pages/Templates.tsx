// Templates — lista, criação e detalhes de templates da Meta
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, fmtRel } from '../lib/api'
import { Modal, Pill, Empty, Spinner, Field, Icon, ConfirmButton, useToast } from '../components/ui'
import './Templates.css'

const STATUS: Record<string, { kind: 'ok' | 'warn' | 'crit' | 'dim' | 'info'; label: string }> = {
  APPROVED: { kind: 'ok', label: 'Aprovado' }, PENDING: { kind: 'warn', label: 'Em análise' }, REJECTED: { kind: 'crit', label: 'Rejeitado' },
  PAUSED: { kind: 'dim', label: 'Pausado' }, DISABLED: { kind: 'dim', label: 'Desativado' }, DRAFT: { kind: 'dim', label: 'Rascunho' }
}
const CATEGORY: Record<string, { kind: 'ok' | 'warn' | 'info'; label: string }> = { UTILITY: { kind: 'ok', label: 'Utilidade' }, MARKETING: { kind: 'warn', label: 'Marketing' }, AUTHENTICATION: { kind: 'info', label: 'Autenticação' } }
const LANGS = [{ v: 'pt_BR', l: 'Português (BR)' }, { v: 'pt_PT', l: 'Português (PT)' }, { v: 'en_US', l: 'Inglês (US)' }, { v: 'es', l: 'Espanhol' }]
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 512)
const comp = (t: any, type: string) => (t?.components || []).find((c: any) => c.type === type)
const bodyOf = (t: any) => comp(t, 'BODY')?.text || ''

// Renderiza corpo com {{n}} destacado (ou substituído pelo nome/exemplo)
function Body({ text, names }: { text: string; names?: Record<string, string> }) {
  const parts = text.split(/(\{\{\d+\}\})/g)
  return <>{parts.map((p, i) => { const m = p.match(/^\{\{(\d+)\}\}$/); return m ? <span key={i} className="var">{names?.[m[1]] ? `{{${names[m[1]]}}}` : p}</span> : <React.Fragment key={i}>{p}</React.Fragment> })}</>
}

// Bolha estilo WhatsApp usada na prévia e nos detalhes
function Bubble({ header, body, footer, buttons, names }: { header?: any; body: string; footer?: string; buttons?: any[]; names?: Record<string, string> }) {
  const MEDIA: Record<string, string> = { IMAGE: 'image', VIDEO: 'video', DOCUMENT: 'file' }
  return <div className="wa-bg">
    <div className="wa-bubble">
      {header?.type === 'TEXT' && header.text && <div className="hdr">{header.text}</div>}
      {header && header.type && header.type !== 'TEXT' && header.type !== 'NONE' && <div className="media"><Icon name={MEDIA[header.type] || 'file'} size={22} />{header.type === 'IMAGE' ? 'Imagem' : header.type === 'VIDEO' ? 'Vídeo' : 'Documento'}</div>}
      <div>{body ? <Body text={body} names={names} /> : <span className="dim">O corpo da mensagem aparece aqui…</span>}</div>
      {footer && <div className="ftr">{footer}</div>}
      <div className="time">{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
    {buttons && buttons.length > 0 && <div className="wa-btns">{buttons.map((b, i) => <span key={i}>{b.type === 'COPY_CODE' ? (b.text || 'Copiar código') : b.text || '…'}</span>)}</div>}
  </div>
}

// ---- Modal de criação ----
function NewTemplate({ numbers, onClose, onDone }: { numbers: any[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const [f, setF] = useState<any>({ number_id: numbers[0]?.id || '', name: '', language: 'pt_BR', category: 'UTILITY', headerType: 'NONE', headerText: '', handle: '', body: '', footer: '', buttons: [] as any[], variables: [] as { index: number; name: string; example: string }[] })
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; hits: string[] } | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }))

  // Checador de categoria com debounce
  useEffect(() => {
    if (!f.body.trim()) { setCheck(null); return }
    const t = setTimeout(() => api.post('/tools/category-check', { text: f.body }).then(setCheck).catch(() => {}), 500)
    return () => clearTimeout(t)
  }, [f.body])

  // Mantém variables sincronizado com os {{n}} do corpo
  useEffect(() => {
    const idx = Array.from(new Set((f.body.match(/\{\{(\d+)\}\}/g) || []).map((m: string) => Number(m.replace(/\D/g, ''))))).sort((a: number, b: number) => a - b)
    setF((s: any) => ({ ...s, variables: idx.map((i: number) => s.variables.find((v: any) => v.index === i) || { index: i, name: '', example: '' }) }))
  }, [f.body])

  const addVar = () => {
    const next = (f.body.match(/\{\{\d+\}\}/g) || []).length + 1
    const name = window.prompt(`Nome da variável {{${next}}} (ex.: primeiro_nome, valor, produto)`, next === 1 ? 'primeiro_nome' : '')
    if (name === null) return
    const el = bodyRef.current; const pos = el ? el.selectionStart : f.body.length
    const body = f.body.slice(0, pos) + `{{${next}}}` + f.body.slice(pos)
    setF((s: any) => ({ ...s, body, variables: [...s.variables, { index: next, name: slug(name || `var_${next}`), example: '' }] }))
    setTimeout(() => { el?.focus(); el?.setSelectionRange(pos + `{{${next}}}`.length, pos + `{{${next}}}`.length) }, 0)
  }
  const setVar = (i: number, k: string, v: string) => set('variables', f.variables.map((x: any) => x.index === i ? { ...x, [k]: v } : x))
  const upload = async (file: File) => {
    setUploading(true)
    try { const r = await api.upload('/templates/header-upload', file, f.number_id ? { number_id: f.number_id } : {}); set('handle', r.handle); toast('Mídia enviada para a Meta') }
    catch (e: any) { toast(e.message, true) } finally { setUploading(false) }
  }
  const addBtn = () => { if (f.buttons.length >= 3) return; set('buttons', [...f.buttons, { type: 'QUICK_REPLY', text: '', url: '', phone: '' }]) }
  const setBtn = (i: number, k: string, v: string) => set('buttons', f.buttons.map((b: any, j: number) => j === i ? { ...b, [k]: v } : b))

  const submit = async () => {
    if (!f.name) return toast('Dê um nome ao template', true)
    if (!f.body.trim()) return toast('O corpo da mensagem é obrigatório', true)
    if (f.headerType !== 'NONE' && f.headerType !== 'TEXT' && !f.handle) return toast('Envie o arquivo de exemplo do cabeçalho', true)
    if (f.variables.some((v: any) => !v.example)) return toast('Preencha um exemplo para cada variável (a Meta exige)', true)
    setBusy(true)
    try {
      await api.post('/templates', {
        number_id: f.number_id || undefined, name: slug(f.name), language: f.language, category: f.category,
        header: f.headerType === 'NONE' ? undefined : f.headerType === 'TEXT' ? { type: 'TEXT', text: f.headerText } : { type: f.headerType, handle: f.handle },
        body: f.body, footer: f.footer || undefined,
        buttons: f.buttons.filter((b: any) => b.type === 'COPY_CODE' || b.text).map((b: any) => ({ type: b.type, text: b.text, url: b.url || undefined, phone: b.phone || undefined })),
        bodyExamples: f.variables.map((v: any) => v.example), variables: f.variables.map((v: any) => ({ index: v.index, name: v.name }))
      })
      toast('Template enviado para análise da Meta'); onDone()
    } catch (e: any) { toast(e.message, true) } finally { setBusy(false) }
  }
  const names = Object.fromEntries(f.variables.map((v: any) => [String(v.index), v.name]))

  return <Modal title="Novo template" size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn p" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <Icon name="upload" />}Enviar para a Meta</button></>}>
    <div className="tpl-form">
      <div>
        <div className="grid g2">
          <Field label="Número / WABA"><select className="sel" value={f.number_id} onChange={e => set('number_id', e.target.value)}>{numbers.length === 0 && <option value="">Nenhum número conectado</option>}{numbers.map(n => <option key={n.id} value={n.id}>{n.label} · {n.display_phone}</option>)}</select></Field>
          <Field label="Nome" hint={f.name ? `Será salvo como ${slug(f.name)}` : 'Minúsculas, números e _'}><input className="inp" value={f.name} onChange={e => set('name', e.target.value)} onBlur={() => set('name', slug(f.name))} placeholder="pix_lembrete_1" /></Field>
        </div>
        <div className="grid g2">
          <Field label="Idioma"><select className="sel" value={f.language} onChange={e => set('language', e.target.value)}>{LANGS.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}</select></Field>
          <Field label="Categoria" hint={f.category === 'UTILITY' ? 'Utilidade é a mais barata e só passa com texto transacional (pedido, pagamento, entrega).' : f.category === 'MARKETING' ? 'Marketing custa mais por conversa e exige opt-out; a Meta pode limitar o volume.' : 'Só para códigos de verificação.'}>
            <select className="sel" value={f.category} onChange={e => set('category', e.target.value)}><option value="UTILITY">Utilidade</option><option value="MARKETING">Marketing</option><option value="AUTHENTICATION">Autenticação</option></select></Field>
        </div>
        <Field label="Cabeçalho">
          <div className="seg" style={{ width: 'fit-content' }}>{[['NONE', 'Nenhum'], ['TEXT', 'Texto'], ['IMAGE', 'Imagem'], ['VIDEO', 'Vídeo'], ['DOCUMENT', 'Documento']].map(([v, l]) => <button key={v} type="button" className={f.headerType === v ? 'on' : ''} onClick={() => set('headerType', v)}>{l}</button>)}</div>
        </Field>
        {f.headerType === 'TEXT' && <Field label="Texto do cabeçalho" hint="Até 60 caracteres, sem variáveis."><input className="inp" maxLength={60} value={f.headerText} onChange={e => set('headerText', e.target.value)} /></Field>}
        {f.headerType !== 'NONE' && f.headerType !== 'TEXT' && <Field label="Arquivo de exemplo" hint="A Meta usa este arquivo só para aprovar o template. No envio real, você escolhe a mídia no funil.">
          <div className="row"><input type="file" className="inp" accept={f.headerType === 'IMAGE' ? 'image/*' : f.headerType === 'VIDEO' ? 'video/*' : '.pdf,application/pdf'} onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />{uploading ? <Spinner /> : f.handle ? <Pill kind="ok">Enviado</Pill> : null}</div>
        </Field>}
        <Field label="Corpo da mensagem" hint="Máximo 1024 caracteres. Use variáveis para personalizar (nome, valor, link do Pix…).">
          <textarea ref={bodyRef} className="ta" style={{ minHeight: 120 }} maxLength={1024} value={f.body} onChange={e => set('body', e.target.value)} placeholder={'Olá {{1}}, vimos que você gerou um Pix de {{2}} para o {{3}}. O código expira em breve.'} />
          <div className="row"><button type="button" className="btn sm" onClick={addVar}><Icon name="var" />+ variável</button><span className="dim" style={{ fontSize: 11.5 }}>{f.body.length}/1024</span></div>
        </Field>
        {check && (check.ok ? <div className="cat-check ok">Texto transacional: boa chance de aprovar como Utilidade.</div> : <div className="cat-check warn">Palavras que a Meta costuma reclassificar como marketing: <b>{check.hits.join(', ')}</b>. Considere reescrever ou usar a categoria Marketing.</div>)}
        {f.variables.length > 0 && <Field label="Variáveis" hint="O nome é como você vai chamar a variável nos funis; o exemplo vai para a Meta na aprovação.">
          <div className="tpl-vars">{f.variables.map((v: any) => <div className="tpl-var" key={v.index}><span className="idx">{`{{${v.index}}}`}</span><input className="inp" value={v.name} onChange={e => setVar(v.index, 'name', slug(e.target.value))} placeholder="nome (ex.: primeiro_nome)" /><input className="inp" value={v.example} onChange={e => setVar(v.index, 'example', e.target.value)} placeholder="exemplo (ex.: Rafael)" /><span /></div>)}</div>
        </Field>}
        <Field label="Rodapé" hint="Opcional, até 60 caracteres."><input className="inp" maxLength={60} value={f.footer} onChange={e => set('footer', e.target.value)} placeholder="Responda SAIR para não receber mais" /></Field>
        <Field label="Botões" hint="Até 3. Resposta rápida gera uma saída no funil; URL/telefone abrem fora do WhatsApp.">
          {f.buttons.map((b: any, i: number) => <div className="tpl-btn-row" key={i}>
            <select className="sel" value={b.type} onChange={e => setBtn(i, 'type', e.target.value)}><option value="QUICK_REPLY">Resposta rápida</option><option value="URL">Link</option><option value="PHONE_NUMBER">Telefone</option><option value="COPY_CODE">Copiar código</option></select>
            <input className="inp" maxLength={25} value={b.text} onChange={e => setBtn(i, 'text', e.target.value)} placeholder={b.type === 'COPY_CODE' ? 'Copiar código Pix' : 'Texto do botão'} />
            {b.type === 'URL' ? <input className="inp" value={b.url} onChange={e => setBtn(i, 'url', e.target.value)} placeholder="https://…" /> : b.type === 'PHONE_NUMBER' ? <input className="inp" value={b.phone} onChange={e => setBtn(i, 'phone', e.target.value)} placeholder="+5511999990000" /> : <span className="dim" style={{ fontSize: 11.5 }}>{b.type === 'COPY_CODE' ? 'o código vai no envio' : ''}</span>}
            <button type="button" className="btn g sm icon" onClick={() => set('buttons', f.buttons.filter((_: any, j: number) => j !== i))}><Icon name="x" /></button>
          </div>)}
          {f.buttons.length < 3 && <button type="button" className="btn sm" onClick={addBtn}><Icon name="plus" />Adicionar botão</button>}
        </Field>
      </div>
      <div className="side">
        <div className="field"><label>Prévia</label></div>
        <Bubble header={f.headerType === 'NONE' ? undefined : { type: f.headerType, text: f.headerText }} body={f.body} footer={f.footer} buttons={f.buttons} names={names} />
        <p className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>A aprovação da Meta costuma levar de minutos a 24h. Você recebe o status aqui automaticamente.</p>
      </div>
    </div>
  </Modal>
}

// ---- Modal de detalhes ----
function Detail({ t, onClose, onChange }: { t: any; onClose: () => void; onChange: () => void }) {
  const { toast } = useToast()
  const body = bodyOf(t)
  const idx: number[] = Array.from(new Set<number>((body.match(/\{\{(\d+)\}\}/g) || []).map((m: string) => Number(m.replace(/\D/g, ''))))).sort((a: number, b: number) => a - b)
  const [vars, setVars] = useState<{ index: number; name: string }[]>(idx.map(i => ({ index: i, name: t.variables?.find((v: any) => v.index === i)?.name || '' })))
  const [busy, setBusy] = useState(false)
  const header = comp(t, 'HEADER'), footer = comp(t, 'FOOTER'), buttons = comp(t, 'BUTTONS')?.buttons || []
  const st = STATUS[t.status] || STATUS.DRAFT, cat = CATEGORY[t.category]
  const save = async () => { setBusy(true); try { await api.put(`/templates/${t.id}`, { variables: vars.map(v => ({ index: v.index, name: slug(v.name) })) }); toast('Nomes das variáveis salvos'); onChange() } catch (e: any) { toast(e.message, true) } finally { setBusy(false) } }
  const del = async () => { try { await api.del(`/templates/${t.id}`); toast('Template excluído'); onChange(); onClose() } catch (e: any) { toast(e.message, true) } }

  return <Modal title={<span className="mono">{t.name}</span>} size="lg" onClose={onClose} footer={<><ConfirmButton onConfirm={del} label="Excluir na Meta também?"><Icon name="trash" />Excluir</ConfirmButton><span style={{ flex: 1 }} /><button className="btn" onClick={onClose}>Fechar</button>{idx.length > 0 && <button className="btn p" disabled={busy} onClick={save}>{busy ? <Spinner /> : <Icon name="check" />}Salvar nomes</button>}</>}>
    <div className="tpl-detail">
      <div>
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          <Pill kind={st.kind}>{st.label}</Pill>{cat && <Pill kind={cat.kind}>{cat.label}</Pill>}<Pill kind="dim">{t.language}</Pill>{t.quality && t.quality !== 'UNKNOWN' && <Pill kind={t.quality === 'GREEN' ? 'ok' : t.quality === 'YELLOW' ? 'warn' : 'crit'}>Qualidade {t.quality === 'GREEN' ? 'alta' : t.quality === 'YELLOW' ? 'média' : 'baixa'}</Pill>}
        </div>
        {t.status === 'REJECTED' && t.rejected_reason && <div className="cat-check warn" style={{ marginTop: 0 }}>Motivo da rejeição: {t.rejected_reason}</div>}
        <div className="field"><label>Componentes</label></div>
        <table style={{ marginBottom: 14 }}><tbody>
          {header && <tr><td className="dim" style={{ width: 90 }}>Cabeçalho</td><td>{header.format === 'TEXT' ? header.text : <Pill kind="info">{header.format}</Pill>}</td></tr>}
          <tr><td className="dim">Corpo</td><td style={{ whiteSpace: 'pre-wrap' }}>{body}</td></tr>
          {footer && <tr><td className="dim">Rodapé</td><td>{footer.text}</td></tr>}
          {buttons.length > 0 && <tr><td className="dim">Botões</td><td>{buttons.map((b: any, i: number) => <div key={i}><Pill kind="dim">{b.type}</Pill> {b.text} {b.url && <span className="mono dim" style={{ fontSize: 11 }}>{b.url}</span>}{b.phone_number && <span className="mono dim" style={{ fontSize: 11 }}>{b.phone_number}</span>}</div>)}</td></tr>}
        </tbody></table>
        {idx.length > 0 && <Field label="Nomes das variáveis" hint="Use esses nomes nos funis para mapear cada {{n}} (ex.: primeiro_nome, valor, link_pix).">
          <div className="tpl-vars">{vars.map((v, i) => <div className="tpl-var" key={v.index} style={{ gridTemplateColumns: '52px 1fr' }}><span className="idx">{`{{${v.index}}}`}</span><input className="inp" value={v.name} onChange={e => setVars(vars.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="primeiro_nome" /></div>)}</div>
        </Field>}
        {t.meta_id && <div className="dim" style={{ fontSize: 11.5 }}>ID na Meta: <span className="mono">{t.meta_id}</span>{t.synced_at ? ` · sincronizado ${fmtRel(t.synced_at)}` : ''}</div>}
      </div>
      <div><div className="field"><label>Prévia</label></div><Bubble header={header ? { type: header.format, text: header.text } : undefined} body={body} footer={footer?.text} buttons={buttons} names={Object.fromEntries(vars.filter(v => v.name).map(v => [String(v.index), v.name]))} /></div>
    </div>
  </Modal>
}

export default function Templates() {
  const { toast } = useToast()
  const [list, setList] = useState<any[] | null>(null)
  const [numbers, setNumbers] = useState<any[]>([])
  const [status, setStatus] = useState('all'), [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false), [creating, setCreating] = useState(false), [open, setOpen] = useState<any>(null)
  const load = () => Promise.all([api.get('/templates'), api.get('/numbers').catch(() => [])]).then(([t, n]) => { setList(t); setNumbers(n) }).catch((e: any) => { toast(e.message, true); setList([]) })
  useEffect(() => { load() }, [])
  const sync = async () => { setSyncing(true); try { const r = await api.post('/templates/sync'); toast(`${r.synced} templates sincronizados`); load() } catch (e: any) { toast(e.message, true) } finally { setSyncing(false) } }
  const rows = useMemo(() => (list || []).filter(t => (status === 'all' || t.status === status) && (!search || t.name.includes(search.toLowerCase()) || bodyOf(t).toLowerCase().includes(search.toLowerCase()))), [list, status, search])
  const counts = useMemo(() => (list || []).reduce((m: Record<string, number>, t) => { m[t.status] = (m[t.status] || 0) + 1; return m }, {}), [list])

  return <main className="main">
    <div className="top">
      <div><h1>Templates</h1><div className="sub">Mensagens aprovadas pela Meta para iniciar conversa fora da janela de 24h</div></div>
      <div className="tools">
        <button className="btn" disabled={syncing} onClick={sync}>{syncing ? <Spinner /> : <Icon name="refresh" />}Sincronizar com a Meta</button>
        <button className="btn p" onClick={() => numbers.length ? setCreating(true) : toast('Conecte um número antes de criar templates', true)}><Icon name="plus" />Novo template</button>
      </div>
    </div>
    <div className="card">
      <div className="row between" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="seg">{[['all', 'Todos'], ['APPROVED', 'Aprovados'], ['PENDING', 'Em análise'], ['REJECTED', 'Rejeitados'], ['PAUSED', 'Pausados']].map(([v, l]) => <button key={v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}{v !== 'all' && counts[v] ? ` (${counts[v]})` : ''}</button>)}</div>
        <input className="inp" style={{ width: 260 }} placeholder="Buscar por nome ou texto…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {list === null ? <div className="empty"><Spinner /></div> :
        rows.length === 0 ? <Empty title={list.length === 0 ? 'Nenhum template ainda' : 'Nada encontrado com esse filtro'} action={list.length === 0 ? <button className="btn p" onClick={sync}>Sincronizar com a Meta</button> : undefined}>{list.length === 0 ? 'Sincronize os templates da sua conta ou crie um novo. Sem template aprovado, o funil não consegue iniciar conversa.' : 'Tente outro status ou termo de busca.'}</Empty> :
          <table>
            <thead><tr><th>Nome</th><th>Categoria</th><th>Idioma</th><th>Status</th><th>Qualidade</th><th>Prévia</th></tr></thead>
            <tbody>{rows.map(t => { const st = STATUS[t.status] || STATUS.DRAFT, cat = CATEGORY[t.category]; return <tr key={t.id} className="click" onClick={() => setOpen(t)}>
              <td className="m">{t.name}</td>
              <td>{cat ? <Pill kind={cat.kind}>{cat.label}</Pill> : <Pill kind="dim">{t.category || '—'}</Pill>}</td>
              <td className="m">{t.language}</td>
              <td><Pill kind={st.kind}>{st.label}</Pill>{t.status === 'REJECTED' && t.rejected_reason && <div className="tpl-reject" title={t.rejected_reason}>{t.rejected_reason.length > 60 ? t.rejected_reason.slice(0, 60) + '…' : t.rejected_reason}</div>}</td>
              <td>{!t.quality || t.quality === 'UNKNOWN' ? <span className="dim">—</span> : <Pill kind={t.quality === 'GREEN' ? 'ok' : t.quality === 'YELLOW' ? 'warn' : 'crit'}>{t.quality === 'GREEN' ? 'Alta' : t.quality === 'YELLOW' ? 'Média' : 'Baixa'}</Pill>}</td>
              <td><div className="tpl-preview-cell" title={bodyOf(t)}>{bodyOf(t)}</div></td>
            </tr> })}</tbody>
          </table>}
    </div>
    {creating && <NewTemplate numbers={numbers} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />}
    {open && <Detail t={open} onClose={() => setOpen(null)} onChange={load} />}
  </main>
}
