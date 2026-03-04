# GoLink

Personal URL shortener — type `go/anything` in Chrome and get redirected to the real URL.

Consists of two components:
1. **FastAPI service** (`api/`) — stores and serves links, hosted on Render.com
2. **Chrome extension** (`extension/`) — intercepts `http://go/*` navigations and resolves them against a local cache

---

## Architecture

```
Browser types: go/gh
         │
         ▼
Chrome extension (background.js)
  ├─ Cache hit?  ──yes──▶  chrome.tabs.update(targetUrl)
  └─ Cache miss? ──no───▶  chrome.tabs.update(API /go/{slug})
                                    │
                                    ▼
                           FastAPI on Render.com
                            └─ 302 → target URL
```

Cache is synced every 30 minutes (configurable) by calling `GET /api/links` with a JWT token.

---

## API (`api/`)

### Stack
- **FastAPI** + **Uvicorn**
- **SQLAlchemy** (SQLite locally, PostgreSQL on Render)
- **python-jose** for JWT auth
- **python-dotenv** for config

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/go/{slug}` | — | Redirect to target URL (302) |
| `POST` | `/api/auth/token` | — | Get JWT token |
| `GET` | `/api/links` | JWT | List all links |
| `POST` | `/api/links` | JWT | Create a link |
| `PUT` | `/api/links/{slug}` | JWT | Update a link |
| `DELETE` | `/api/links/{slug}` | JWT | Delete a link |
| `GET` | `/health` | — | Health check |

### Local development

```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # edit .env with your secrets
uvicorn api.main:app --reload  # runs on http://localhost:8000
```

Interactive docs at http://localhost:8000/docs

### Getting a JWT token (local)

```bash
curl -X POST http://localhost:8000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "change-me"}'
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./golink.db` | SQLAlchemy connection string |
| `JWT_SECRET_KEY` | `change-me-...` | Secret for signing JWTs — **change in prod** |
| `ADMIN_USERNAME` | `admin` | Username for token endpoint |
| `ADMIN_PASSWORD` | `change-me` | Password for token endpoint — **change in prod** |

### Deploy to Render.com

1. Push this repo to GitHub (done).
2. Create a new **Web Service** on [render.com](https://render.com), connect this repo.
3. Set **Root Directory** to `api`.
4. **Build command**: `pip install -r requirements.txt`
5. **Start command**: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
6. Add **Environment Variables** in the Render dashboard:
   - `DATABASE_URL` — use Render's PostgreSQL add-on URL
   - `JWT_SECRET_KEY` — long random string
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD`
7. (Optional) Add a **PostgreSQL** database from Render's dashboard and copy the connection string.

> **Note**: Render's free tier spins down after 15 minutes of inactivity (cold start ~30 s). If that's annoying, upgrade to a paid plan or use the extension's fallback — the cache handles most requests anyway.

---

## Chrome Extension (`extension/`)

### Stack
- Manifest V3
- `chrome.webNavigation` for URL interception
- `chrome.storage.local` for cache
- `chrome.alarms` for periodic sync

### How it works

1. On install and every 30 minutes, the background service worker calls `GET /api/links` with the stored JWT token and writes the result to `chrome.storage.local`.
2. When you navigate to `http://go/{slug}`, `webNavigation.onBeforeNavigate` fires, looks up the slug in the cache, and calls `chrome.tabs.update` with the real URL.
3. On cache miss the tab is forwarded to the API's `/go/{slug}` endpoint, which issues a 302.

### Load in Chrome (development)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Click the GoLink puzzle-piece icon to open the popup

### Configure the extension

In the popup:
1. Paste your Render.com URL (e.g. `https://golink-xxxx.onrender.com`) as the **API base URL** and click **Save**.
2. Obtain a JWT token from the token endpoint (see above) and paste it into **JWT token**, then click **Save**.
3. Click **Sync now** — the link count should update.

From now on, typing `go/gh` (or any slug you created) in the address bar will redirect you.

### Browser note — `go/` as a hostname

Chrome must be able to resolve `go` as a hostname (not a search query). This usually works on corporate networks where `go` is a real intranet hostname. On a personal machine you can add the following to `/etc/hosts`:

```
127.0.0.1 go
```

Then requests to `http://go/anything` will be intercepted by the extension before they ever reach the (non-existent) server.

---

## Project structure

```
golink/
├── README.md
├── .gitignore
├── api/
│   ├── __init__.py
│   ├── main.py          # FastAPI app, routes
│   ├── models.py        # SQLAlchemy ORM models
│   ├── database.py      # Engine + session factory
│   ├── auth.py          # JWT creation + verification
│   ├── schemas.py       # Pydantic request/response models
│   ├── requirements.txt
│   └── .env.example
└── extension/
    ├── manifest.json    # MV3 manifest
    ├── background.js    # Service worker: intercept + cache + sync
    ├── popup.html
    ├── popup.js
    └── popup.css
```

---

## Roadmap / next steps

- [ ] Add `/api/links/search?q=` endpoint for fuzzy slug search
- [ ] Support wildcard / prefix slugs (e.g. `go/jira/123` → `https://jira.company.com/browse/123`)
- [ ] Extension options page for advanced settings (sync interval, etc.)
- [ ] Badge on extension icon showing cache age
- [ ] CLI tool (`golink add gh https://github.com`) for quick link management
- [ ] Import/export links as CSV/JSON
