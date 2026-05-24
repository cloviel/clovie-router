# OGW Router

OpenAI-compatible API gateway that proxies to upstream LLM providers.

## Features

- 🔑 **API Key Management** — Generate, revoke, toggle keys via dashboard
- 🔄 **Transparent Proxy** — Forwards `/v1/chat/completions`, `/v1/models`, etc.
- 🌊 **Streaming Support** — Full SSE streaming passthrough
- 🎨 **Premium Dashboard** — Dark theme with animated mesh background
- 🚀 **Vercel Ready** — One-click deploy

## Quick Start

```bash
# Install
npm install

# Configure .env.local
UPSTREAM_BASE_URL=https://opengateway.gitlawb.com/v1/xiaomi-mimo
UPSTREAM_API_KEY=ogw_live_...
ADMIN_SECRET=your-admin-secret

# Run
npm run dev
```

## Usage

```bash
# Generate a key via dashboard at http://localhost:3000
# Then use it:

curl https://your-domain.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer ogw-your-generated-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mimo-v2.5-pro",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

## Deploy to Vercel

```bash
npx vercel --prod
```

Set environment variables in Vercel dashboard:
- `UPSTREAM_BASE_URL` — Upstream API base URL
- `UPSTREAM_API_KEY` — Upstream API key
- `ADMIN_SECRET` — Dashboard access secret
- `NEXT_PUBLIC_ADMIN_SECRET` — Same as ADMIN_SECRET (for client)
- `NEXT_PUBLIC_UPSTREAM` — Display name of upstream

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat completions (streaming) |
| GET | `/v1/models` | List available models |
| GET | `/api/admin/keys` | List API keys (admin) |
| POST | `/api/admin/keys` | Generate new key (admin) |
| DELETE | `/api/admin/keys` | Revoke key (admin) |
| PATCH | `/api/admin/keys` | Toggle key (admin) |

## Architecture

```
Client → OGW Router (your base URL)
           ├── Validates API key (ogw-xxx)
           ├── Swaps for upstream key
           ├── Forwards to upstream
           └── Returns response (JSON/SSE)
```
