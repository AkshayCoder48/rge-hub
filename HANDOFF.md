# HANDOFF — Secure Secrets Manifest

> **Rule (PRD §25): credentials are NEVER committed to this repository and
> NEVER pasted into chat.** This file lists the secret NAMES and where each
> one belongs. Transfer actual values through Vercel/GitHub secret
> management (or an encrypted channel), then rotate anything that was ever
> exposed in plain text.

## Where secrets live

| Secret | Where to set it | Notes |
|---|---|---|
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → PAT | Push access to `AkshayCoder48/rge-hub` + `AkshayCoder48/onyx-base`. **Rotate the one used during this handoff — it was exposed in chat.** |
| `VERCEL_TOKEN` | Vercel → Settings → Tokens | Deploy trigger for both projects. **Rotate — exposed in chat.** |
| `MCPEMAILS_API_KEY` | Vercel → rge-hub → Env Vars | `mcpe_…` key from mcpemails.com (needs `send:email` scope). Server-side only. While unset, OTP email falls back to OnyxBase's connected MCPEmail credential. |
| `MCPEMAILS_INBOX_ID` | Vercel → rge-hub → Env Vars | Optional — only for multi-inbox keys. |
| `VERCEL_ORG_ID` | (identifier, not secret) | `team_cqDKL1bJHd6R2OtjoSADj2Gs` |
| `VERCEL_PROJECT_ID_RGE_HUB` | (identifier, not secret) | `prj_U38KVXrmshHwhqd19zXe0onQEnxu` → rge-hub.vercel.app |
| `VERCEL_PROJECT_ID_ONYXBASE` | (identifier, not secret) | `prj_1sDJqgh9ICKMP4GcbAGq2Gp45NmB` → onyxbase-chi.vercel.app |
| `ONYXBASE_API_KEY` | Vercel → rge-hub → Env Vars | OnyxBase master key (`kv_live_…`) for profiles/resources/follows. |
| `ONYXBASE_BASE_URL` | Vercel → rge-hub → Env Vars | `https://onyxbase-chi.vercel.app` |
| `SESSION_SECRET` | Vercel → rge-hub → Env Vars | `openssl rand -hex 32`. Signs sessions + password-reset tokens. **Set this** — without it, sessions reset on every deploy. |
| `AISENSE_STORAGE_URL` | (optional) | Defaults to `https://aisenseapi.com/services/v1/storage` — no key needed. |

## Application env templates

- RGE Hub: `.env.example` (this repo)
- OnyxBase: `.env.example` in the onyx-base repo

## Non-secret runtime endpoints added in this overhaul

| Endpoint | Purpose |
|---|---|
| `GET /api/health` (rge-hub) | Component health: OTP temp storage, email, OnyxBase, session secret |
| `GET /api/operations/{id}` (rge-hub) | Reconcile lost/timed-out mutations (never guess "failed") |
| `GET /api/livez`, `GET /api/health/ready` (onyx-base) | Liveness / readiness probes |
