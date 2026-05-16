# Autofoda Instagram Ops

Painel local/serverless para publicar e gerenciar Instagram usando somente API oficial da Meta. Suporta multi-contas, Supabase/Postgres, Cloudflare R2 para mídias públicas, Vercel Cron, Reels, imagens, carrossel, comentários e fila de aprovação.

## Arquiteturas suportadas

### Local

- Express rodando continuamente.
- Docker Postgres.
- Storage local ou R2.
- `node-cron` ativo a cada minuto.

### Vercel

- Frontend estático em `public`.
- API serverless em `api/index.ts`.
- Cron em `api/cron/publish.ts`.
- Supabase Postgres via `DATABASE_URL`.
- Cloudflare R2 para arquivos públicos.
- Sem depender de `/videos` local em produção.

## Variáveis principais

```dotenv
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
OAUTH_REDIRECT_URI=https://seu-app.vercel.app/auth/callback

GRAPH_API_VERSION=v25.0
GRAPH_API_HOST=https://graph.instagram.com
DATABASE_URL=postgresql://...

CRON_SECRET=um-segredo-forte

R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=autofoda-media
R2_PUBLIC_BASE_URL=https://media.seudominio.com

PUBLIC_BASE_URL=https://seu-app.vercel.app
PUBLIC_FILE_KEY=gere-com-openssl-rand-hex-32
```

`PUBLIC_BASE_URL` ainda é usado como fallback local. Quando `R2_PUBLIC_BASE_URL` está configurado, a Meta recebe a URL pública do R2.

## Supabase

Use a connection string do Supabase Postgres em `DATABASE_URL`. As migrations rodam automaticamente quando a API sobe.

Exemplo:

```dotenv
DATABASE_URL=postgresql://postgres.xxx:SENHA@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

Se estiver migrando do Postgres local sem perder OAuth, exporte/importa as tabelas, principalmente `accounts`.

## Cloudflare R2

Crie um bucket separado, por exemplo:

```text
autofoda-media
```

Configure um domínio público para ele:

```text
https://media.seudominio.com
```

No `.env`/Vercel env:

```dotenv
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=autofoda-media
R2_PUBLIC_BASE_URL=https://media.seudominio.com
```

Uploads do painel vão para R2 e ficam salvos no banco com `public_url`. Essa URL é usada como `video_url`/`image_url` na Meta.

## Vercel Cron

Existe o endpoint:

```text
/api/cron/publish
```

O `vercel.json` agenda a cada minuto:

```json
{
  "path": "/api/cron/publish",
  "schedule": "* * * * *"
}
```

Se `CRON_SECRET` estiver configurado, o endpoint exige:

```text
Authorization: Bearer CRON_SECRET
```

ou:

```text
/api/cron/publish?secret=CRON_SECRET
```

Observação: Vercel Cron pode não enviar header customizado automaticamente. Se você exigir segredo, use query secret em cron externo ou chame manualmente. O endpoint funciona sem segredo se `CRON_SECRET` ficar vazio, mas não é recomendado em produção.

## Meta App Dashboard

Configure a redirect URI:

```text
https://seu-app.vercel.app/auth/callback
```

Escopos:

```text
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_comments
```

## Rodar local

```bash
npm install
npm run db:up
npm run dev
```

Abra:

```text
http://localhost:3000
```

## Deploy Vercel

1. Suba o projeto no GitHub.
2. Importe na Vercel.
3. Configure as env vars do Supabase, R2 e Meta.
4. Configure no Meta Dashboard:

```text
https://seu-app.vercel.app/auth/callback
```

5. Faça deploy.

## Limites importantes

- SQLite local não é usado na Vercel; use Supabase/Postgres.
- R2 precisa ter URL pública acessível pela Meta.
- Vídeos/Reels podem demorar no processamento da Meta. O endpoint atual ainda tenta publicar no mesmo ciclo; para vídeos muito longos, uma fila por estados é a próxima evolução.
- Carrossel usa `CAROUSEL`, não Reels.
- PNG é convertido localmente/serverless para JPEG antes de ir para R2.

## Scripts

```bash
npm run dev
npm run build
npm start
npm run db:up
```
