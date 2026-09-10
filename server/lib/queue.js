// Fila de jobs baseada em Postgres (pg-boss): delays, retries e cron sem Redis
import PgBoss from 'pg-boss'

export const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss', retryLimit: 3, retryBackoff: true, archiveCompletedAfterSeconds: 3600, deleteAfterDays: 7 })

export const JOBS = {
  AUTOMATION_FIRE: 'automation-fire',   // dispara uma automação para um contato após o delay
  FUNNEL_STEP: 'funnel-step',           // executa o próximo nó de uma run
  RUN_TIMEOUT: 'run-timeout',           // timeout de "esperar resposta"
  CAMPAIGN_TICK: 'campaign-tick',       // envia o próximo lote de uma campanha
  MEDIA_DOWNLOAD: 'media-download',     // baixa mídia recebida
  NUMBER_SYNC: 'number-sync',           // atualiza qualidade/limite dos números
  TEMPLATE_SYNC: 'template-sync',
  DAILY_ROLLUP: 'daily-rollup'
}

export async function startQueue() {
  boss.on('error', e => console.error('[queue]', e.message))
  await boss.start()
  for (const name of Object.values(JOBS)) await boss.createQueue(name).catch(() => {})
  return boss
}

export const enqueue = (name, data, opts = {}) => boss.send(name, data, opts)
export const enqueueIn = (name, data, seconds, opts = {}) => boss.send(name, data, { startAfter: Math.max(0, Math.floor(seconds)), ...opts })
