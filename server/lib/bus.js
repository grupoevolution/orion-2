// Eventos em tempo real para o painel (SSE)
import { EventEmitter } from 'node:events'
export const bus = new EventEmitter()
bus.setMaxListeners(200)

export function sseHandler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  const onMsg = d => send('message', d), onSt = d => send('status', d), onTpl = d => send('templates', d), onRun = d => send('run', d)
  bus.on('message', onMsg); bus.on('status', onSt); bus.on('templates', onTpl); bus.on('run', onRun)
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)
  req.on('close', () => { clearInterval(ping); bus.off('message', onMsg); bus.off('status', onSt); bus.off('templates', onTpl); bus.off('run', onRun) })
}
