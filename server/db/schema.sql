-- Orion 2.0 — esquema principal (idempotente)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Números conectados na Cloud API
CREATE TABLE IF NOT EXISTS numbers (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  phone_number_id TEXT UNIQUE NOT NULL,
  waba_id TEXT NOT NULL,
  display_phone TEXT,
  verified_name TEXT,
  token_enc TEXT NOT NULL,
  quality_rating TEXT DEFAULT 'UNKNOWN',     -- GREEN | YELLOW | RED | UNKNOWN
  messaging_limit TEXT DEFAULT 'TIER_250',   -- TIER_250 | TIER_1K | TIER_10K | TIER_100K | TIER_UNLIMITED
  daily_cap INT,                             -- limite manual opcional (menor que o tier)
  status TEXT DEFAULT 'active',              -- active | paused | error
  last_error TEXT,
  weight INT DEFAULT 1,
  is_default BOOLEAN DEFAULT false,
  accept_inbound BOOLEAN DEFAULT true,
  meta JSONB DEFAULT '{}',
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS number_daily (
  number_id INT REFERENCES numbers(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  sent INT DEFAULT 0,
  delivered INT DEFAULT 0,
  read INT DEFAULT 0,
  failed INT DEFAULT 0,
  received INT DEFAULT 0,
  template_sent INT DEFAULT 0,
  PRIMARY KEY (number_id, day)
);

-- Templates aprovados na Meta (sincronizados por WABA)
CREATE TABLE IF NOT EXISTS templates (
  id SERIAL PRIMARY KEY,
  waba_id TEXT NOT NULL,
  meta_id TEXT,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pt_BR',
  category TEXT NOT NULL DEFAULT 'UTILITY',  -- UTILITY | MARKETING | AUTHENTICATION
  status TEXT DEFAULT 'DRAFT',               -- DRAFT | PENDING | APPROVED | REJECTED | PAUSED | DISABLED
  rejected_reason TEXT,
  components JSONB NOT NULL DEFAULT '[]',
  variables JSONB NOT NULL DEFAULT '[]',     -- mapeamento {{1}} -> nome_da_variavel
  quality TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (waba_id, name, language)
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,                -- E.164 sem "+", ex: 5511999990000
  wa_id TEXT,
  name TEXT,
  email TEXT,
  document TEXT,
  owner_number_id INT REFERENCES numbers(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  opted_out BOOLEAN DEFAULT false,
  blocked BOOLEAN DEFAULT false,
  source TEXT,                               -- kirvano | ad | import | inbound | manual
  ad_id TEXT,
  ad_headline TEXT,
  first_purchase_at TIMESTAMPTZ,
  last_purchase_at TIMESTAMPTZ,
  total_purchases INT DEFAULT 0,
  total_spent NUMERIC(12,2) DEFAULT 0,
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  window_expires_at TIMESTAMPTZ,             -- janela 24h (ou 72h para lead de anúncio)
  variables JSONB DEFAULT '{}',              -- variáveis salvas por funis
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts (lower(email));
CREATE INDEX IF NOT EXISTS contacts_owner_idx ON contacts (owner_number_id);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  contact_id INT REFERENCES contacts(id) ON DELETE CASCADE,
  number_id INT REFERENCES numbers(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  last_preview TEXT,
  last_direction TEXT,
  unread INT DEFAULT 0,
  status TEXT DEFAULT 'open',                -- open | closed
  assigned_to INT REFERENCES admins(id),
  UNIQUE (contact_id, number_id)
);
CREATE INDEX IF NOT EXISTS conversations_last_idx ON conversations (last_message_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                        -- image | video | audio | document | sticker
  mime TEXT,
  filename TEXT,
  path TEXT,                                 -- caminho local
  size INT,
  duration INT,
  meta_media_id TEXT,                        -- id do upload na Meta (por número)
  meta_number_id INT,
  meta_uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id INT REFERENCES contacts(id) ON DELETE CASCADE,
  number_id INT REFERENCES numbers(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,                   -- in | out
  wa_message_id TEXT UNIQUE,
  type TEXT NOT NULL,                        -- text | template | image | video | audio | document | interactive | button | reaction | sticker | location | contacts | unsupported | system
  body TEXT,
  payload JSONB DEFAULT '{}',
  media_id INT REFERENCES media(id),
  template_name TEXT,
  status TEXT DEFAULT 'queued',              -- queued | sent | delivered | read | failed | received
  error TEXT,
  funnel_run_id INT,
  campaign_id INT,
  sent_by INT REFERENCES admins(id),
  pricing JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_run_idx ON messages (funnel_run_id);

-- Eventos de venda (Kirvano e futuros gateways)
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  gateway TEXT NOT NULL DEFAULT 'kirvano',
  sale_id TEXT NOT NULL,
  contact_id INT REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL,                      -- pending | approved | refused | canceled | refunded | chargeback | abandoned
  payment_method TEXT,
  amount NUMERIC(12,2) DEFAULT 0,
  net_amount NUMERIC(12,2),
  product_name TEXT,
  offer_id TEXT,
  offer_name TEXT,
  products JSONB DEFAULT '[]',
  pix_code TEXT,
  payment_link TEXT,
  utm JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ,
  attributed_run_id INT,                     -- run de funil que recebe o crédito da conversão
  attributed_campaign_id INT,
  is_rebuy BOOLEAN DEFAULT false,
  UNIQUE (gateway, sale_id)
);
CREATE INDEX IF NOT EXISTS sales_contact_idx ON sales (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                      -- kirvano | meta | system
  type TEXT NOT NULL,                        -- pix_generated | approved | refused | abandoned | refunded | ad_lead | inbound ...
  contact_id INT REFERENCES contacts(id) ON DELETE SET NULL,
  sale_id INT REFERENCES sales(id) ON DELETE SET NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_type_idx ON events (type, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  headers JSONB,
  body JSONB,
  status TEXT DEFAULT 'received',            -- received | processed | ignored | error
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Funis (grafo de nós do construtor)
CREATE TABLE IF NOT EXISTS funnels (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',               -- draft | published | archived
  version INT DEFAULT 1,
  nodes JSONB NOT NULL DEFAULT '[]',
  edges JSONB NOT NULL DEFAULT '[]',
  viewport JSONB DEFAULT '{}',
  folder TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- Automações: gatilho -> regras -> variantes de funil
CREATE TABLE IF NOT EXISTS automations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,                     -- pix_generated | approved | refused | abandoned | ad_lead | inbound_new | tag_added
  active BOOLEAN DEFAULT false,
  delay_seconds INT DEFAULT 0,               -- pix_generated: 420 (7 min) por padrão
  skip_if_paid BOOLEAN DEFAULT true,
  min_amount NUMERIC(12,2),
  max_amount NUMERIC(12,2),
  product_filter JSONB DEFAULT '[]',         -- lista de offer_id/nomes; vazio = todos
  cooldown_hours INT DEFAULT 72,             -- não recontatar o mesmo lead nesse período
  only_first_event BOOLEAN DEFAULT true,     -- por padrão só o 1º evento desse tipo por lead
  send_window JSONB DEFAULT '{"start":"08:00","end":"23:00","tz":"America/Sao_Paulo"}',
  outside_window TEXT DEFAULT 'wait',        -- wait | skip
  variants JSONB NOT NULL DEFAULT '[]',      -- [{funnel_id, weight}]
  auto_optimize BOOLEAN DEFAULT false,
  attribution_hours INT DEFAULT 24,
  priority INT DEFAULT 0,
  stats JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funnel_runs (
  id SERIAL PRIMARY KEY,
  funnel_id INT REFERENCES funnels(id) ON DELETE SET NULL,
  funnel_version INT,
  automation_id INT REFERENCES automations(id) ON DELETE SET NULL,
  campaign_id INT,
  contact_id INT REFERENCES contacts(id) ON DELETE CASCADE,
  number_id INT REFERENCES numbers(id) ON DELETE SET NULL,
  sale_id INT REFERENCES sales(id) ON DELETE SET NULL,
  trigger TEXT,
  status TEXT DEFAULT 'scheduled',           -- scheduled | running | waiting_reply | waiting_delay | done | cancelled | failed
  current_node TEXT,
  variables JSONB DEFAULT '{}',
  last_error TEXT,
  replied BOOLEAN DEFAULT false,
  converted BOOLEAN DEFAULT false,
  converted_sale_id INT,
  converted_at TIMESTAMPTZ,
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_contact_idx ON funnel_runs (contact_id, status);
CREATE INDEX IF NOT EXISTS runs_funnel_idx ON funnel_runs (funnel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'template',              -- template | funnel
  template_id INT REFERENCES templates(id),
  template_params JSONB DEFAULT '{}',        -- {"1":"{{primeiro_nome}}"}
  funnel_id INT REFERENCES funnels(id),
  number_ids INT[] DEFAULT '{}',
  daily_limit INT DEFAULT 100,
  per_minute INT DEFAULT 10,
  send_window JSONB DEFAULT '{"start":"09:00","end":"21:00","tz":"America/Sao_Paulo"}',
  status TEXT DEFAULT 'draft',               -- draft | scheduled | running | paused | done
  starts_at TIMESTAMPTZ,
  stats JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_contacts (
  id SERIAL PRIMARY KEY,
  campaign_id INT REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INT REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',             -- pending | sent | delivered | read | replied | failed | skipped
  number_id INT,
  message_id BIGINT,
  run_id INT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  UNIQUE (campaign_id, contact_id)
);
CREATE INDEX IF NOT EXISTS cc_status_idx ON campaign_contacts (campaign_id, status);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_id INT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Configurações padrão
INSERT INTO settings (key, value) VALUES
  ('pix_delay_minutes', '7'),
  ('attribution_hours', '24'),
  ('quiet_hours', '{"start":"23:00","end":"08:00","tz":"America/Sao_Paulo"}'),
  ('optout_keywords', '["parar","sair","cancelar","stop","não quero","nao quero"]'),
  ('ad_window_hours', '72'),
  ('greeting', '{"morning":"Bom dia","afternoon":"Boa tarde","night":"Boa noite"}'),
  ('number_routing', '"owner_then_least_loaded"')
ON CONFLICT (key) DO NOTHING;
