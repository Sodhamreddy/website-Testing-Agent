# Deploy to Hostinger

> **This project's target: Hostinger Business (shared) hosting, deployed from `main`.**
> That is **Option A** below — `dist/` on Hostinger, backend on a separate host.
> Business hosting gives you LiteSpeed + PHP + SSH, but **no Node.js runtime and no
> root**, so `npm install`, a long-lived Express process, and Chromium's system
> libraries are all off the table there. The audit engine needs its own box.

## Read this first: what can and cannot go on Hostinger shared hosting

This app is **two programs**, not one:

| Part | What it is | Runs on Hostinger shared hosting? |
|---|---|---|
| Frontend | Static React build → `dist/` | ✅ Yes — that's all shared hosting does |
| Backend | Node/Express + **Playwright (real Chromium)** + Gemini API | ❌ **No** |

Hostinger's Web / Premium / Business / Cloud plans serve static files and PHP.
There is no Node.js runtime, no long-lived process, no way to install the ~300 MB
of Chromium and its system libraries, and no way to hold an SSE connection open
for the 2–3 minutes an audit takes.

So there are two deployment shapes:

- **A — Split.** `dist/` on Hostinger shared hosting, backend somewhere that runs
  Node (a **Hostinger VPS**, or the Azure VM in [DEPLOY-AZURE.md](DEPLOY-AZURE.md)).
  Requires building with `VITE_API_BASE` pointed at the backend.
- **B — All on a Hostinger VPS.** One box runs everything, exactly like the Azure
  guide. Simplest to reason about; nothing is split across origins.

Uploading `dist/` alone gets you a dashboard that loads and then fails the moment
you press *Run audit* — the UI is a client for an API that isn't there.

---

# Option A — `dist/` on Hostinger, backend elsewhere

### 1. Build with the backend URL baked in

The frontend calls `/api/audit/stream` relatively by default. When it is served
from a different origin than the backend, tell it where the backend is **at build
time** (Vite inlines `VITE_*` vars into the bundle):

PowerShell:
```powershell
$env:VITE_API_BASE = "https://api.yourdomain.com"
npm run build
```

bash:
```bash
VITE_API_BASE=https://api.yourdomain.com npm run build
```

Confirm it took:
```bash
grep -o "https://api.yourdomain.com" dist/assets/*.js
```

The backend must be reachable over **HTTPS** — the Hostinger page is HTTPS, and a
browser blocks a plain-HTTP `EventSource` from an HTTPS page as mixed content.

`server/index.ts` already sends `app.use(cors())`, so cross-origin requests are
allowed. Lock that down to your real domain before this is public:

```ts
app.use(cors({ origin: 'https://testing.yourdomain.com' }));
```

### 2. Upload `dist/` to `public_html`

`dist/` is ~700 KB — either method takes a minute.

**hPanel File Manager (easiest)**

1. Zip the *contents* of `dist/` (not the folder itself):
   ```powershell
   Compress-Archive -Path dist\* -DestinationPath dist.zip -Force
   ```
   `Compress-Archive` skips dotfiles, so **`.htaccess` will not be in the zip** —
   upload it separately in step 4, or use FTP instead.
2. hPanel → **Files → File Manager** → open `public_html`.
3. Delete Hostinger's placeholder `default.php` / `index.html` if present.
4. **Upload** `dist.zip` → right-click → **Extract**, then delete the zip.
5. Upload `dist/.htaccess` into `public_html` (File Manager → *Show hidden files*).

**SSH / rsync (best for Business hosting — it includes SSH access)**

hPanel → **Advanced → SSH Access** → enable it, note the host, port and username:
```bash
rsync -avz --delete -e "ssh -p <port>" dist/ <user>@<host>:~/public_html/
```
`rsync` copies dotfiles, so `.htaccess` goes up with everything else, and
`--delete` clears the previous build's stale hashed assets.

**FTP (if SSH isn't enabled)**

hPanel → **Files → FTP Accounts** for host/user/password, then in FileZilla or:
```bash
lftp -u <ftp_user>,<ftp_pass> ftp://<ftp_host> -e "mirror -R --delete dist/ /public_html/; bye"
```
`--delete` removes files from a previous build that are no longer in `dist/` —
important, since each build emits new hashed asset filenames.

### 3. Point the domain and check

- hPanel → **Domains** — attach the domain/subdomain to this hosting.
- hPanel → **Security → SSL** — issue the free Let's Encrypt cert, force HTTPS.
- Load the site: the dashboard should render.
- Press **Run audit**: the log panel should start streaming. If it dies instantly,
  open DevTools → Network → the `stream` request — see Troubleshooting below.

### 4. What still needs a real server

The backend from this repo, running somewhere with Node 20 + Chromium. Steps 3–6
and 8 of [DEPLOY-AZURE.md](DEPLOY-AZURE.md) apply unchanged on a Hostinger VPS —
install Node, `npx playwright install --with-deps chromium`, `pm2 start npm --name
testing-agent -- run server`, then Nginx + certbot in front of it on
`api.yourdomain.com`.

The Nginx block for an API-only host (note the SSE settings — without them the
audit is cut off at ~60s):

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

---

# Option B — everything on a Hostinger VPS

A Hostinger VPS is a plain Ubuntu box, so [DEPLOY-AZURE.md](DEPLOY-AZURE.md)
applies start to finish — only how you get the machine differs.

1. hPanel → **VPS → Create** → Ubuntu 22.04, **KVM 2 or larger** (2 vCPU / 8 GB).
   The 1 vCPU / 4 GB KVM 1 works but Chromium will be tight on heavy pages.
   Install **Node 22**, not the Node 20 the Azure guide used to specify (now corrected).
2. hPanel → **Domains → DNS Zone** → `A` record for your subdomain → the VPS IP.
3. SSH in and follow DEPLOY-AZURE.md sections 3–9 verbatim.

With this shape the frontend keeps using **relative** `/api` URLs — do **not** set
`VITE_API_BASE`, and Nginx serves `dist/` and proxies `/api` on the same origin.

---

## Backend prerequisites (both options)

**Node 22, not 20.** `openai@7.10.0` declares `"engines": { "node": ">=22.0.0" }`,
so `npm install` fails the engine check on Node 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v22.x
```

**Chromium is a separate install.** `npm install` gets the Playwright *library*;
the browser and its ~100 system libraries come from:
```bash
npx playwright install --with-deps chromium
```
Budget ~2 GB disk and 4 GB+ RAM for the box.

---

## Where `.env` goes — and where it must NOT go

There are **two** separate configs. They live in different places and behave
differently. Copy [`.env.example`](../.env.example) to `.env` to start.

### ❌ Never put `.env` in `dist/` or `public_html`

It does nothing and it leaks your key:

- **It does nothing.** `dist/` is compiled static JavaScript. Nothing in it reads
  a file at runtime — there is no `process.env` in a browser. Vite substitutes
  `VITE_*` values into the bundle **at build time**; a `.env` sitting next to
  `index.html` is never opened by anything.
- **It leaks the key.** `public_html` is the public web root. A file there is a
  plain download at `https://yourdomain.com/.env`, and bots scan that exact path
  continuously. A Gemini key posted there is typically abused within hours.

`public/.htaccess` now denies dotfiles as defence in depth, but the rule is a
safety net — do not rely on it. Keep `.env` out of the upload entirely.
`rsync dist/ …` never picks it up, because `.env` is not in `dist/`.

### ✅ Frontend config — project root, at build time

`VITE_API_BASE` goes in `.env` **in the project root on your machine**, and gets
baked into the bundle when you build:

```bash
# .env (project root)
VITE_API_BASE=https://api.yourdomain.com
```
```bash
npm run build     # Vite reads root .env and inlines VITE_* into dist/assets/*.js
```

Verify it landed:
```bash
grep -o "https://api.yourdomain.com" dist/assets/*.js
```

Only `VITE_`-prefixed vars are exposed — `AI_API_KEY` in the same file is **not**
inlined (verified: it does not appear anywhere in `dist/`). But treat every
`VITE_*` value as public, because it ships readable inside the bundle. Never put
a secret behind a `VITE_` prefix.

### ✅ Backend config — on the backend host, outside the web root

`AI_API_KEY` and friends live in `.env` next to `server/` on whatever box runs
Node — the VPS or Azure VM, never Hostinger shared hosting:

```bash
cd /var/www/testing-agent
nano .env          # paste the AI_* block from .env.example, fill in the key
chmod 600 .env     # owner-only
pm2 restart testing-agent
```

`npm run server` loads it via `tsx --env-file-if-exists=.env`. Confirm it took:
```bash
pm2 logs testing-agent   # a missing key warns on startup from server/agent/client.ts
```

### `.env` is gitignored — keep it that way

`.env` had been committed to the repo (with a blank key). It is now untracked;
`.env.example` is the committed template. Before any commit:
```bash
git status --short | grep -w "\.env$"    # must print nothing
```

---

## The backend needs secrets

⚠️ [DEPLOY-AZURE.md](DEPLOY-AZURE.md) ends with "No secrets needed — the engine is
fully deterministic". **That is out of date.** Since commit `b5015c3` the default
engine is agentic and calls Gemini. Wherever the backend runs, create a `.env`
next to the code:

```bash
AI_API_KEY=<your Google AI Studio key>
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_MODEL=gemini-flash-lite-latest
AI_RPM=10
```

`npm run server` loads it via `tsx --env-file-if-exists=.env`. `.env` is
gitignored — never upload it through a public web root.

---

## Redeploying the frontend

```powershell
$env:VITE_API_BASE = "https://api.yourdomain.com"
npm run build
```
then push the folder up:
```bash
rsync -avz --delete -e "ssh -p <port>" dist/ <user>@<host>:~/public_html/
```

Asset filenames are content-hashed and `.htaccess` marks `index.html`
`no-cache`, so returning users pick up the new build on their next load.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Dashboard loads, audit fails instantly | Backend unreachable. Check `VITE_API_BASE` is in the bundle and that the API host answers over HTTPS. |
| Console: *blocked mixed content* | `VITE_API_BASE` is `http://`. The API needs a TLS cert. |
| Console: *CORS policy* | Backend's `cors()` origin doesn't include the Hostinger domain. |
| Audit dies at ~60 seconds | Nginx SSE settings missing (`proxy_buffering off`, `proxy_read_timeout`). |
| Blank page, 404s on `/assets/*.js` | `dist/`'s *contents* weren't extracted directly into `public_html` — an extra nested folder. |
| Deep link 404s | `.htaccess` didn't upload (it's a dotfile — enable *Show hidden files*). |
| Trying to run `npm` on shared hosting | Not possible. Use a VPS. |
