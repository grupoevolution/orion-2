// Lista de funis
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtNum, fmtPct, fmtRel } from '../lib/api'
import { useToast, Modal, Pill, Empty, Spinner, Icon, ConfirmButton } from '../components/ui'

const STATUS: Record<string, { label: string; kind: 'ok' | 'dim' | 'warn' }> = {
  draft: { label: 'Rascunho', kind: 'dim' },
  published: { label: 'Publicado', kind: 'ok' },
  archived: { label: 'Arquivado', kind: 'warn' }
}

export default function Funnels() {
  const nav = useNavigate()
  const { toast } = useToast()
  const [list, setList] = useState<any[] | null>(null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/funnels').then(setList).catch(e => toast(e.message, true))
  useEffect(() => { load() }, [])

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (list || []).filter(f => !s || f.name.toLowerCase().includes(s))
  }, [list, search])

  const create = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try { const f = await api.post('/funnels', { name: newName.trim() }); nav('/funis/' + f.id) }
    catch (e: any) { toast(e.message, true) } finally { setBusy(false) }
  }
  const duplicate = async (f: any) => {
    try { await api.post(`/funnels/${f.id}/duplicate`); toast('Funil duplicado'); load() } catch (e: any) { toast(e.message, true) }
  }
  const archive = async (f: any) => {
    try { await api.del(`/funnels/${f.id}`); toast('Funil arquivado'); load() } catch (e: any) { toast(e.message, true) }
  }

  return <main className="main">
    <div className="top">
      <div><h1>Funis</h1><div className="sub">Sequências de mensagens que o Orion envia sozinho quando uma automação dispara</div></div>
      <div className="tools">
        <div style={{ position: 'relative' }}>
          <input className="inp" placeholder="Buscar por nome" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220, paddingLeft: 32 }} />
          <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--dim)' }}><Icon name="search" size={15} /></span>
        </div>
        <button className="btn p" onClick={() => { setNewName(''); setCreating(true) }}><Icon name="plus" />Novo funil</button>
      </div>
    </div>

    {list === null && <div className="empty"><Spinner /></div>}

    {list !== null && list.length === 0 && <div className="card"><Empty title="Nenhum funil ainda"
      action={<button className="btn p" onClick={() => setCreating(true)}><Icon name="plus" />Criar o primeiro funil</button>}>
      Um funil é a conversa automática que o cliente recebe: começa com um template aprovado pela Meta, pode esperar a resposta, mandar botões, áudio, ou tomar decisões. Depois de publicado, ligue o funil a uma automação (ex.: Pix gerado) para ele disparar sozinho.
    </Empty></div>}

    {list !== null && list.length > 0 && rows.length === 0 && <div className="card"><Empty title="Nada encontrado">Nenhum funil com “{search}”.</Empty></div>}

    <div className="grid g3">
      {rows.map(f => {
        const st = STATUS[f.status] || STATUS.draft
        return <div key={f.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="h" style={{ marginBottom: 0 }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => nav('/funis/' + f.id)}>{f.name}</h3>
              <p>{f.description || 'Sem descrição'}</p>
            </div>
            <div className="row" style={{ flex: 'none' }}><Pill kind={st.kind}>{st.label}</Pill><span className="mono dim" style={{ fontSize: 11 }}>v{f.version}</span></div>
          </div>
          <div className="grid g3" style={{ gap: 8 }}>
            <Stat k="Envios" v={fmtNum(f.runs)} />
            <Stat k="Respostas" v={fmtPct(f.replies, f.runs)} />
            <Stat k="Conversões" v={fmtPct(f.conversions, f.runs)} />
          </div>
          <div className="row between" style={{ marginTop: 'auto' }}>
            <span className="dim" style={{ fontSize: 12 }}>Atualizado {fmtRel(f.updated_at)}</span>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm p" onClick={() => nav('/funis/' + f.id)}>Abrir</button>
              <button className="btn sm g" title="Duplicar" onClick={() => duplicate(f)}><Icon name="copy" size={14} /></button>
              <ConfirmButton className="btn sm g" label="Arquivar?" onConfirm={() => archive(f)}><Icon name="trash" size={14} /></ConfirmButton>
            </div>
          </div>
        </div>
      })}
    </div>

    {creating && <Modal title="Novo funil" onClose={() => setCreating(false)}
      footer={<><button className="btn" onClick={() => setCreating(false)}>Cancelar</button><button className="btn p" disabled={busy || !newName.trim()} onClick={create}>{busy ? 'Criando…' : 'Criar e abrir'}</button></>}>
      <div className="field"><label>Nome do funil</label>
        <input className="inp" autoFocus placeholder="Ex.: Recuperação de Pix" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        <span className="hint">Você monta os blocos no construtor logo em seguida.</span></div>
    </Modal>}
  </main>
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px' }}>
    <div className="dim" style={{ fontSize: 11 }}>{k}</div>
    <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{v}</div>
  </div>
}
