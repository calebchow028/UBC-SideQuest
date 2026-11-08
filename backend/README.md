# SideQuest Backend

REST API for **UBC SideQuest**: student profiles, a matchmaking queue that pairs two students, one shared AI-generated quest per match, and two-person completion.

Stack: Node.js 22+, TypeScript (strict), Express 5, SQLite (better-sqlite3), Zod, Auth0 JWT (`express-oauth2-jwt-bearer`), Vitest + Supertest.

---

## 1. Install

```bash
cd backend
npm install
```

Requires Node.js 22 or newer (`node --version`). better-sqlite3 ships prebuilt binaries for Windows/Linux/macOS, so no compiler is needed.

## 2. Run locally

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

**Option A: no Auth0 yet (frontend development).** In `.env` set:

```
NODE_ENV=development
AUTH_MODE=dev
```

Then send `Authorization: Bearer dev:<any-name>` (e.g. `dev:alice`, `dev:bob`) to act as different users. The server prints a warning on startup. It **refuses to start** with `AUTH_MODE=dev` unless `NODE_ENV=development`.

**Option B: real Auth0.** Set `AUTH_MODE=auth0`, `AUTH0_ISSUER_BASE_URL` and `AUTH0_AUDIENCE`.

```bash
npm run dev                 # watch mode (tsx) on http://127.0.0.1:3000
# or
npm run build && npm start  # compiled
```

Check it: `curl http://127.0.0.1:3000/health` → `{"status":"ok","service":"sidequest-backend"}`

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with auto-reload |
| `npm run build` | Compile to `dist/` (and copy `schema.sql`) |
| `npm start` | Run `dist/server.js` |
| `npm test` | Run all tests |
| `npm run test:coverage` | Tests + coverage report (`coverage/index.html`) |
| `npm run typecheck` | TypeScript check incl. tests |
| `npm run smoke [url]` | Smoke test a running server (see §9) |

## 3. Environment variables

See [.env.example](.env.example). Invalid config stops startup with a list of problems (variable names only, never values).

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. `0.0.0.0` to expose directly; keep `127.0.0.1` behind nginx |
| `DATABASE_PATH` | `./data/sidequest.db` | SQLite file (directory is created) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:8080` | Comma-separated allowed browser origins. `https://*.lovable.app` matches any subdomain |
| `TRUST_PROXY` | `false` | `true` behind nginx |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error`/`silent` |
| `AUTH_MODE` | `auth0` | `auth0`, or `dev` (local only) |
| `AUTH0_ISSUER_BASE_URL` | none | e.g. `https://dev-xyz.us.auth0.com/`. Required for `auth0` |
| `AUTH0_AUDIENCE` | none | Auth0 API identifier. Required for `auth0` |
| `MARITIME_AGENT_URL` | none | Quest agent endpoint. Empty = always use fallback quests |
| `MARITIME_API_KEY` | none | Sent as `Authorization: Bearer …` to the agent |
| `MARITIME_TIMEOUT_MS` | `10000` | Agent request timeout |
| `N8N_WEBHOOK_URL` | none | n8n webhook. Empty = events disabled |
| `N8N_WEBHOOK_SECRET` | none | Sent as `X-SideQuest-Secret` header |
| `N8N_TIMEOUT_MS` | `5000` | Webhook request timeout |
| `OUTBOX_POLL_INTERVAL_MS` | `15000` | How often undelivered events are retried |
| `OUTBOX_MAX_ATTEMPTS` | `8` | Give up on an event after this many failures |
| `MATCH_RELAX_AFTER_SECONDS` | `45` | After this wait, users can match without a shared interest |

## 4. API

All `/api/*` routes need `Authorization: Bearer <access token>`. The user id is **always** the token's `sub`; ids in request bodies are ignored.

Errors are always:

```json
{ "error": { "code": "MATCH_CANCELLED", "message": "This match was cancelled and cannot be completed.", "details": "optional" } }
```

| Status | When |
| --- | --- |
| 400 `VALIDATION_ERROR` / `INVALID_JSON` | Bad input (`details` lists `{path, message}`) |
| 401 `UNAUTHORIZED` | Missing/invalid/expired token |
| 403 `FORBIDDEN` | Not a participant of that match |
| 404 `PROFILE_NOT_FOUND` / `MATCH_NOT_FOUND` / `ROUTE_NOT_FOUND` | Not found |
| 409 | State conflict (`PROFILE_REQUIRED`, `ALREADY_MATCHED`, `QUEST_NOT_READY`, `MATCH_CANCELLED`, `MATCH_ALREADY_COMPLETED`) |
| 500 `INTERNAL_ERROR` | Bug (details are logged, never returned) |

### `GET /health` (public)

```json
{ "status": "ok", "service": "sidequest-backend" }
```

### `GET /api/profile`

200 with the profile, or 404 `PROFILE_NOT_FOUND` if none yet.

```json
{
  "id": "auth0|6543...",
  "displayName": "Steven",
  "interests": ["music", "food", "hiking"],
  "comfortLevel": "chill",
  "availableMinutes": 30,
  "maxBudget": 0,
  "createdAt": "2026-11-07T12:00:00.000Z",
  "updatedAt": "2026-11-07T12:00:00.000Z",
  "stats": { "completedQuests": 0, "totalXp": 0 }
}
```

### `PUT /api/profile`

Create or update. Returns the profile (as above).

```json
{ "displayName": "Steven", "interests": ["music", "food", "hiking"], "comfortLevel": "chill", "availableMinutes": 30, "maxBudget": 0 }
```

| Field | Rule |
| --- | --- |
| `displayName` | 1–50 chars (trimmed) |
| `interests` | 1–10 strings, ≤30 chars each; lower-cased, trimmed, de-duplicated |
| `comfortLevel` | `chill` \| `adventure` \| `chaos` |
| `availableMinutes` | integer 15–240 |
| `maxBudget` | number 0–1000 (CAD) |

### `POST /api/queue/join`

Needs a profile (else 409 `PROFILE_REQUIRED`). Idempotent: repeat calls keep your place in line. If you're already in a match, returns that match.

```json
{ "status": "waiting", "matchId": null }
{ "status": "matched", "matchId": "match_04f8c826..." }
```

### `POST /api/queue/leave`

Idempotent. `{ "status": "idle", "left": true }` (`left: false` if you weren't queued).
If you're already matched it returns **409 `ALREADY_MATCHED`** with `details.matchId` and does *not* cancel the match. Use the cancel endpoint for that.

### `GET /api/queue/status`

```json
{ "status": "idle",       "matchId": null, "joinedAt": null }
{ "status": "waiting",    "matchId": null, "joinedAt": "2026-11-07T12:00:00.000Z" }
{ "status": "generating", "matchId": "match_…", "joinedAt": null }
{ "status": "active",     "matchId": "match_…", "joinedAt": null }
```

`generating` = matched, quest being created. `active` = quest ready. (`matched` is only returned by `/join`.) After a match completes or is cancelled, status goes back to `idle`.
**Frontend: poll this every 2–3 s while waiting.** Polling also retries matching, which is how the "relax after 45 s" rule kicks in.

### `GET /api/quests/:matchId`

Participants only (403 otherwise).

```json
{
  "matchId": "match_…",
  "matchStatus": "active",
  "questStatus": "ready",
  "quest": {
    "id": "quest_…",
    "title": "The Playlist Exchange",
    "description": "Meet in a public seating area at the Nest...",
    "location": "UBC Nest",
    "durationMinutes": 15,
    "xp": 50,
    "createdAt": "2026-11-07T12:00:02.000Z"
  },
  "partner": { "displayName": "Ben" },
  "completion": { "confirmedByMe": false, "partnerConfirmed": false }
}
```

`questStatus`: `pending` (still generating, `quest: null`, poll again), `ready`, or `unavailable` (cancelled before a quest existed). `matchStatus`: `generating` | `active` | `completed` | `cancelled`.

### `POST /api/quests/:matchId/complete`

Records *your* confirmation. Idempotent.

```json
{ "matchId": "match_…", "matchStatus": "active",    "confirmedByMe": true, "partnerConfirmed": false, "waitingForPartner": true }
{ "matchId": "match_…", "matchStatus": "completed", "confirmedByMe": true, "partnerConfirmed": true,  "waitingForPartner": false }
```

409 `QUEST_NOT_READY` while generating; 409 `MATCH_CANCELLED` if cancelled.

### `POST /api/matches/:matchId/cancel`

Either participant. Idempotent for already-cancelled matches; 409 `MATCH_ALREADY_COMPLETED` for completed ones.

```json
{ "matchId": "match_…", "matchStatus": "cancelled" }
```

### Typical frontend flow

1. `GET /api/profile`: if 404, show onboarding → `PUT /api/profile`.
2. `POST /api/queue/join`. If `waiting`, poll `GET /api/queue/status` until it shows a `matchId`.
3. Poll `GET /api/quests/:matchId` until `questStatus === "ready"`; show the quest.
4. "We did it!" → `POST /api/quests/:matchId/complete`; show "waiting for partner" until `matchStatus === "completed"`.

## 5. Matchmaking

`src/domain/compatibility.ts`:

```
score = 10 × shared interests
      + round(5 × shorterAvailableTime / longerAvailableTime)    (0–5)
      + 3 same comfort level, 1 adjacent (chill↔adventure↔chaos), 0 otherwise
```

- **Eligible** if they share ≥1 interest, or either has waited ≥ `MATCH_RELAX_AFTER_SECONDS`.
- Pick the highest score; ties → earliest `joinedAt` (FIFO), then insertion order.
- The quest uses the stricter settings: min time, min budget, most conservative comfort level.

**Concurrency and integrity.** Each join/status check runs in one SQLite `BEGIN IMMEDIATE` transaction. The transaction takes the write lock before reading the queue, so two requests (or two processes) can't claim the same partner. The schema also enforces:

- one waiting entry per user (partial unique index)
- no self-matches (CHECK)
- at most one open match per user (trigger)
- terminal statuses never change (trigger)
- one quest per match (UNIQUE)
- one confirmation per participant, and only participants can confirm (PK + trigger)

## 6. Auth0 integration (Person 4)

1. Auth0 Dashboard → **Applications → APIs → Create API**. Pick an identifier, e.g. `https://api.ubc-sidequest`, with signing algorithm **RS256**. That identifier is `AUTH0_AUDIENCE`.
2. `AUTH0_ISSUER_BASE_URL` = `https://<your-tenant>.auth0.com/` (or your region's domain).
3. Frontend (SPA app in Auth0) must request tokens **for that audience**, e.g. `authorizationParams: { audience: "https://api.ubc-sidequest" }`, then send `Authorization: Bearer <access token>`. ID tokens won't work; it must be an access token.
4. Add the frontend's URLs to the SPA app's Allowed Callback/Logout/Web Origins, and to `CORS_ORIGINS` here.

The backend verifies signature (tenant JWKS), `iss`, `aud` and `exp`, and uses `sub` as the user id.

## 7. Maritime integration (Person 3)

When a match is created the backend makes **one** request for the pair:

```http
POST $MARITIME_AGENT_URL
Authorization: Bearer $MARITIME_API_KEY      (if set)
Content-Type: application/json

{
  "users": [
    { "interests": ["music", "food"],   "comfortLevel": "chill" },
    { "interests": ["music", "hiking"], "comfortLevel": "adventure" }
  ],
  "durationMinutes": 20,
  "maxBudget": 0,
  "allowedLocations": ["UBC Nest", "Irving K. Barber Learning Centre", "Koerner Library", "Main Mall", "Martha Piper Plaza", "UBC Rose Garden", "Buchanan Courtyard", "UBC Life Building", "UBC Bookstore", "Orchard Commons"]
}
```

Expected response (also accepted wrapped as `{ "quest": {...} }`, `{ "data": {...} }` or `{ "output": "<JSON string>" }`):

```json
{
  "title": "The Playlist Exchange",
  "description": "Meet at the UBC Nest and exchange three favorite songs.",
  "location": "UBC Nest",
  "durationMinutes": 20,
  "xp": 50,
  "estimatedCost": 0
}
```

Rules (`src/domain/quest-rules.ts`). If any fail, a predefined safe fallback quest is used and the match still proceeds:

- **Schema:** title 3–80 chars, description 10–1000 chars, `durationMinutes` an integer 5–240, `xp` an integer 5–500, optional `estimatedCost` ≥ 0.
- **Location:** must be on `allowedLocations`. Known aliases like "the Nest" or "IKB" are accepted.
- **Time and money:** `durationMinutes` ≤ the shared `durationMinutes`, and `estimatedCost` ≤ `maxBudget`. With a $0 budget, no "buy/pay/tickets" wording is allowed.
- **Content:** a deterministic keyword blocklist rejects alcohol/drugs, weapons, trespassing/climbing/rooftops, private or off-campus places, romance, late night, pranks/dares, and requests for personal info.
- **Timeout and failures:** the call times out after `MARITIME_TIMEOUT_MS`. Network errors and non-2xx responses also lead to the fallback.

The quest is stored once per match and both users read the same row. If the agent's real API differs, edit only `toMaritimeRequest` / `fromMaritimeResponse` in [src/services/maritime.service.ts](src/services/maritime.service.ts).

## 8. n8n integration (Person 4)

The backend POSTs events to `N8N_WEBHOOK_URL`:

```http
POST $N8N_WEBHOOK_URL
Content-Type: application/json
Idempotency-Key: evt_9b1c...            (same on every retry of this event)
X-SideQuest-Event: match.created
X-SideQuest-Secret: $N8N_WEBHOOK_SECRET  (if set)

{
  "event": "match.created",
  "eventId": "evt_9b1c...",
  "matchId": "match_123",
  "userIds": ["auth0|user-1", "auth0|user-2"],
  "timestamp": "2026-11-07T12:00:00.000Z"
}
```

| Event | When | Extra `data` |
| --- | --- | --- |
| `match.created` | Two users paired | none |
| `quest.created` | Quest stored, match active | `questId, title, location, durationMinutes, xp` |
| `quest.completed` | Both confirmed | `questId` |
| `match.cancelled` | A participant cancelled | none |

- Only Auth0 user ids are sent. To email users, look them up in n8n with the Auth0 Management API (`GET /api/v2/users/{id}`).
- In the n8n Webhook node use **Header Auth**, with header name `X-SideQuest-Secret` and value = the secret.
- Respond 2xx to acknowledge. Anything else (or no answer within `N8N_TIMEOUT_MS`) is retried with backoff (5 s, 10 s, 20 s … ≤10 min) up to `OUTBOX_MAX_ATTEMPTS`.
- Use `eventId` to drop duplicates.
- Events are written to a SQLite outbox in the same transaction as the change, so they survive n8n outages and server restarts. Webhook failures never affect matchmaking.

## 9. Tests

```bash
npm test                # 95 tests
npm run test:coverage
npm run typecheck
```

- Every test uses its own temporary SQLite file.
- Maritime and n8n are replaced with injected fake `fetch` functions. No real services are called.
- Auth tests run the real `express-oauth2-jwt-bearer` middleware against a locally generated RSA key and a local JWKS endpoint.
- Other tests inject a test-only auth middleware through `createApp()`. It lives in `tests/` and cannot be enabled by config or headers.

| File | Covers |
| --- | --- |
| `tests/matchmaking.test.ts` | Scoring unit tests, FIFO, self-match, duplicates, leave, double-booking, concurrent joins, two-connection race, persistence across restart |
| `tests/queue.test.ts` | Queue/cancel endpoints, generating→active, cancel during generation, CORS |
| `tests/profiles.test.ts` | Create/update/validation, can't overwrite others |
| `tests/quests.test.ts` | Safety rules, adapter errors, AI success/timeout/invalid/bad location, fallback, shared quest, completion, cancel |
| `tests/auth.test.ts` | 401/403 cases with real JWTs, production config guards |
| `tests/integrations.test.ts` | Full A+B flow with webhooks, retries/idempotency, give-up, rollback consistency, outbox survives restart |

**Smoke test** against a running server:

```bash
npm run smoke                                   # http://localhost:3000
npm run smoke -- https://api.your-domain.com
SMOKE_TOKEN=dev:alice npm run smoke             # with AUTH_MODE=dev
SMOKE_TOKEN=<auth0 access token> npm run smoke -- https://api.your-domain.com
```

To get a real access token: Auth0 Dashboard → APIs → your API → **Test** tab, or log `await getAccessTokenSilently()` in the frontend. PowerShell: `$env:SMOKE_TOKEN="..."; npm run smoke`.

## 10. Deploy to Vultr

This is a guide; it has not been run against a real Vultr instance yet.

1. Create an **Ubuntu 24.04** instance (the smallest plan is fine) and SSH in as root.
2. Install Node 22, git, nginx:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt-get install -y nodejs git nginx
   adduser --system --group sidequest
   ```
3. Get the code and build:
   ```bash
   mkdir -p /opt/sidequest && chown sidequest:sidequest /opt/sidequest
   sudo -u sidequest git clone https://github.com/stevendoan-cs/UBC-SideQuest.git /opt/sidequest
   cd /opt/sidequest/backend
   sudo -u sidequest npm ci
   sudo -u sidequest npm run build
   sudo -u sidequest npm test        # optional sanity check
   ```
4. Create `/opt/sidequest/backend/.env` (`chmod 600`, owned by `sidequest`) with `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3000`, `TRUST_PROXY=true`, `DATABASE_PATH=/opt/sidequest/data/sidequest.db`, the Auth0 values, `CORS_ORIGINS=https://<your-frontend-domain>`, and the Maritime/n8n values.
5. systemd unit `/etc/systemd/system/sidequest.service`:
   ```ini
   [Unit]
   Description=SideQuest backend
   After=network.target

   [Service]
   User=sidequest
   WorkingDirectory=/opt/sidequest/backend
   ExecStart=/usr/bin/node dist/server.js
   Restart=always
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   mkdir -p /opt/sidequest/data && chown sidequest:sidequest /opt/sidequest/data
   systemctl daemon-reload && systemctl enable --now sidequest
   journalctl -u sidequest -f
   ```
6. nginx `/etc/nginx/sites-available/sidequest`:
   ```nginx
   server {
     listen 80;
     server_name api.your-domain.com;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   ```bash
   ln -s /etc/nginx/sites-available/sidequest /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
   ```
7. HTTPS (needed because the frontend is served over https): point a DNS A record at the instance, then `apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d api.your-domain.com`.
   - No domain? A free option is `<ip>.sslip.io` as the server name.
8. Verify: `npm run smoke -- https://api.your-domain.com`.

Update later: `cd /opt/sidequest && sudo -u sidequest git pull && cd backend && sudo -u sidequest npm ci && sudo -u sidequest npm run build && systemctl restart sidequest`.
Backup: copy `/opt/sidequest/data/sidequest.db` (use `sqlite3 sidequest.db ".backup backup.db"` while running).

## Project layout

```
src/
  app.ts                 Express app factory (no listening; used by tests)
  server.ts              Startup: config, DB, auth choice, outbox timer, graceful shutdown
  container.ts           Wires repositories + services
  config/env.ts          Zod-validated env config
  database/              db.ts (open + transaction helper), schema.sql
  domain/                Pure logic: compatibility scoring, quest safety rules, fallback quests
  repositories/          All SQL
  services/              Business logic: matchmaking, quests, matches, profiles, maritime, notifications
  routes/                Thin HTTP handlers (validate → call service → JSON)
  middleware/            Auth0 + dev auth, error handler
  schemas/               Zod request schemas
tests/                   Vitest + Supertest
scripts/                 copy-assets.mjs, smoke-test.mjs
```
