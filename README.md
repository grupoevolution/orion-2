# Orion 2.0

Painel de automação e atendimento no WhatsApp usando a **Cloud API oficial da Meta**. Substitui o Orion 1.

- Recebe eventos da **Kirvano** (Pix gerado, aprovado, recusado, abandonado) e dispara funis com regras (7 min de espera para Pix, valor mínimo, cooldown, janela de horário).
- **Construtor de funil** visual (React Flow): template, texto, botões, lista, imagem, vídeo, áudio como nota de voz, documento, aguardar, esperar resposta, condição, variável, tag, ir para funil, encerrar.
- **Automações** com variantes A/B e otimização automática por conversão.
- **Campanhas** com lista de contatos, template aprovado, limite diário e distribuição entre números.
- **Inbox** estilo WhatsApp Web, multi-número, com mídia, templates e janela de 24h.
- **Dashboard** de envio, resposta, Pix recuperado, recompra e saúde dos números.

## Stack

Node 20+ · Express · PostgreSQL 14+ (fila com pg-boss, sem Redis) · React 18 + Vite + React Flow · ffmpeg (opcional, converte áudio para OGG/Opus).

## Rodando local

```bash
cp .env.example .env         # edite DATABASE_URL, APP_KEY, JWT_SECRET, ADMIN_*
createdb orion2
npm install && npm run build  # instala e compila o client
npm run dev                   # http://localhost:4000
```

Desenvolvimento do client com hot reload: `npm run client:dev` (porta 5173, proxy para 4000).

Dados de demonstração: `npm run seed:demo` (cria número "demo" pausado, funis, automações, contatos e mensagens com tag `demo`).

## Deploy (VPS)

1. Postgres e Node 20 instalados. `ffmpeg` recomendado (`apt install ffmpeg`).
2. `.env` com `PUBLIC_URL=https://seu-dominio`, `NODE_ENV=production`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `KIRVANO_TOKEN`.
3. `npm install --omit=dev && npm run build && npm start` (ou pm2: `pm2 start server/index.js --name orion2`).
4. Nginx/Caddy com HTTPS na frente (a Meta exige HTTPS no webhook).

Ou Docker: `docker build -t orion2 . && docker run --env-file .env -p 4000:4000 -v $(pwd)/uploads:/app/uploads orion2`.

## Conectando um número (Cloud API)

1. Meta Business Suite → Configurações → Contas do WhatsApp → anote o **WABA ID**.
2. Usuários do sistema → crie um usuário com acesso ao app e à WABA → **gerar token** permanente com `whatsapp_business_messaging` e `whatsapp_business_management`.
3. Em **Números → Conectar número**, cole o token e o WABA ID, escolha o número, salve. O Orion valida, sincroniza os templates e assina o app na WABA.
4. Meta for Developers → seu app → WhatsApp → Configuração → Webhook: URL `PUBLIC_URL/webhook/meta`, verify token = `META_VERIFY_TOKEN`; assine `messages`, `message_template_status_update`, `phone_number_quality_update`.
5. Kirvano → Webhooks: URL `PUBLIC_URL/webhook/kirvano`, token = `KIRVANO_TOKEN`, todos os eventos de venda.

## Regras fixas do sistema

- **Pix gerado**: espera `pix_delay_minutes` (padrão 7) e só envia se o Pix continuar pendente e não houver Pix mais novo.
- **Número dono**: o primeiro número que fala com um lead vira o dono; tudo que for para aquele lead sai por ele enquanto estiver saudável.
- **Janela de 24h**: fora dela só template. O validador de funil obriga o primeiro envio a ser um template.
- **Opt-out**: palavras em `optout_keywords` bloqueiam o contato e cancelam funis em andamento.
- **Saúde**: número com qualidade RED ou sem folga no tier não recebe novos envios; campanhas redistribuem.
