# Deploy Website Testing Agent to Azure — `testing.kleza.io`

This app has two parts that run on **one Azure Linux VM**:

- **Frontend** — static React build (`dist/`), served by **Nginx**.
- **Backend** — Node/Express + **Playwright (headless Chromium)** on port `8787`, kept alive by **PM2**. Nginx reverse-proxies `/api/*` to it.

> Why a VM and not Azure App Service: the audit engine launches a real Chromium browser and runs for 2–3 minutes per request with a streaming (SSE) connection. A VM runs Playwright reliably and gives full control. App Service Linux can do it only with a custom container and tuning — a VM is simpler.

---

## 0. Prerequisites
- An Azure subscription.
- Access to DNS for **kleza.io** (to add an `A` record for `testing`).
- The project code in a Git repo (GitHub/GitLab) or a zip to upload.

---

## 1. Create the Azure VM
Portal → **Virtual machines → Create**:
- **Image:** Ubuntu Server 22.04 LTS
- **Size:** **Standard B2s** (2 vCPU, 4 GB RAM) — minimum for Playwright. B1s (1 GB) is too small.
- **Authentication:** SSH public key (recommended).
- **Inbound ports:** allow **SSH (22)**, **HTTP (80)**, **HTTPS (443)**.
- Create, then note the VM's **Public IP**.

If you skipped the port boxes: VM → **Networking → Add inbound port rule** for 80 and 443.

---

## 2. Point the domain at the VM
In your DNS (where kleza.io is managed), add:

```
Type: A    Name: testing    Value: <VM_PUBLIC_IP>    TTL: 300
```

Verify (wait a few minutes for propagation):
```bash
nslookup testing.kleza.io
```

---

## 3. SSH in and install the runtime
```bash
ssh azureuser@<VM_PUBLIC_IP>

# System packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx

# Node.js 22 LTS — required, NOT 20.
# The agentic engine depends on openai@7, whose package engines field is
# "node": ">=22.0.0"; npm install fails the engine check on Node 20.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v22.x

# PM2 process manager
sudo npm install -g pm2
```

---

## 4. Get the code and install dependencies
```bash
sudo mkdir -p /var/www/testing-agent
sudo chown -R $USER:$USER /var/www/testing-agent
cd /var/www/testing-agent

# Option A: clone from Git
git clone <YOUR_REPO_URL> .
# Option B: upload a zip with scp, then unzip here

npm install

# Install Chromium + all the OS libraries Playwright needs (uses apt under the hood)
npx playwright install --with-deps chromium
```

---

## 5. Build the frontend
```bash
npm run build      # → produces dist/
```

---

## 6. Start the backend with PM2
```bash
# Runs server/index.ts (port 8787) and keeps it alive / restarts on crash
pm2 start npm --name testing-agent -- run server

pm2 save                 # remember the process list
pm2 startup              # prints a command — copy/paste & run it to start on boot
pm2 logs testing-agent   # confirm: "QA audit server ... http://localhost:8787"
```

The backend listens on `127.0.0.1:8787`; only Nginx (below) talks to it.

---

## 7. Configure Nginx (serve `dist/` + proxy `/api` with SSE)
```bash
sudo nano /etc/nginx/sites-available/testing-agent
```

Paste:

```nginx
server {
    listen 80;
    server_name testing.kleza.io;

    root /var/www/testing-agent/dist;
    index index.html;

    # SPA: serve index.html for any front-end route
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API + audit stream (Server-Sent Events)
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Required for SSE streaming + long audits (2-3 min)
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    client_max_body_size 5m;
}
```

Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/testing-agent /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # test config
sudo systemctl reload nginx
```

Now `http://testing.kleza.io` should load the dashboard and audits should run.

---

## 8. Add HTTPS (Let's Encrypt, free)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d testing.kleza.io
# choose "redirect HTTP → HTTPS" when asked
```
Certbot edits the Nginx config for 443 and auto-renews via a systemd timer. Done — `https://testing.kleza.io` is live.

---

## 9. Verify
- Visit **https://testing.kleza.io** → dashboard loads.
- Run an audit on any URL → live log streams, finishes in a few minutes, report shows marked screenshots.
- `pm2 status` → `testing-agent` is `online`.

---

## 10. Redeploy after code changes
```bash
cd /var/www/testing-agent
git pull                 # or re-upload
npm install              # if dependencies changed
npm run build            # rebuild frontend
pm2 restart testing-agent
# Nginx serves the new dist/ immediately; no Nginx reload needed unless config changed
```

---

## Troubleshooting
- **Audit stuck at 0% / API errors:** `pm2 logs testing-agent`. If it mentions missing browser, re-run `npx playwright install --with-deps chromium`.
- **Audit cut off after ~60s:** the Nginx `proxy_read_timeout` / `proxy_buffering off` lines above are required for SSE — recheck them.
- **502 Bad Gateway:** backend isn't running — `pm2 restart testing-agent` and check logs.
- **Out of memory during audits:** resize the VM up (B2s → B2ms/4 GB+). Chromium is memory-hungry on heavy pages.
- **Port 8787 in use:** `pm2 delete testing-agent` then start again; or `sudo lsof -i:8787`.

---

## Notes
- **Secrets ARE needed.** (This line previously said otherwise — it predated the
  agentic engine.) The default engine calls Gemini, so create `/var/www/testing-agent/.env`:
  ```bash
  AI_API_KEY=<your Google AI Studio key>
  AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
  AI_MODEL=gemini-flash-lite-latest
  AI_RPM=10
  ```
  `npm run server` loads it via `tsx --env-file-if-exists=.env`. Without a key the
  audit stream errors out.
- Keep the VM patched: `sudo apt update && sudo apt upgrade -y` periodically.
- The frontend calls the API with **relative URLs** (`/api/...`), so it works behind Nginx on the same domain with no extra config.
