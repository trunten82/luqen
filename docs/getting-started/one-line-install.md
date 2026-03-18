[Docs](../README.md) > [Getting Started](./) > Installation Guide

# Installation Guide

Install Luqen on Linux, macOS, or Windows using the interactive wizard or one-line commands.

---

## Interactive wizard (recommended)

The installer runs an interactive wizard that guides you through deployment mode, pa11y setup, module selection, plugin installation, and admin user creation.

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
```

On macOS you can also download `install.command` and double-click it:

```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.command -o ~/Downloads/install-luqen.command
chmod +x ~/Downloads/install-luqen.command
open ~/Downloads/install-luqen.command
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/trunten82/luqen/master/install.ps1 | iex
```

Or download and run:

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/trunten82/luqen/master/install.ps1 -OutFile install.ps1
.\install.ps1
```

### What the wizard asks

| Step | Question | Options |
|------|----------|---------|
| 1 | Deployment mode | **Docker Compose** (recommended) or **Local Node.js** |
| 2 | Docker template (Docker only) | **Minimal** (bring your own pa11y), **Standard** (includes pa11y + Redis), **Full** (all + monitor + PDF) |
| 3 | pa11y webservice | Existing instance URL, create via Docker, or skip |
| 4 | Modules | Monitor agent (core + compliance + dashboard always included) |
| 5 | Plugins | Select individually or install all (Entra SSO, Slack, Teams, Email, S3, Azure) |
| 6 | Configuration | Ports, install directory |
| 7 | Admin account | Create the first admin user (or log in with API key later) |

---

## Non-interactive install

Pass flags to skip the wizard. Useful for CI/CD and automated deployments.

### Linux / macOS

```bash
# Local Node.js — standard install
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | \
  bash -s -- --local --pa11y-url http://pa11y.internal:3000

# Docker — full stack with all plugins
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | \
  bash -s -- --docker --non-interactive --with-all-plugins

# Docker — minimal with custom ports
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | \
  bash -s -- --docker --non-interactive --port 8000 --pa11y-url http://your-pa11y-host:3000
```

### Windows (PowerShell)

```powershell
# Docker with all plugins
.\install.ps1 -Docker -NonInteractive -WithAllPlugins

# Local with custom pa11y URL
.\install.ps1 -Local -NonInteractive -Pa11yUrl "http://pa11y.internal:3000"
```

### All flags

| Flag (bash) | Flag (PowerShell) | Description |
|---|---|---|
| `--docker` | `-Docker` | Use Docker Compose |
| `--local` | `-Local` | Use local Node.js |
| `--port PORT` | `-Port PORT` | Compliance port (dashboard = PORT+1000) |
| `--pa11y-url URL` | `-Pa11yUrl URL` | Existing pa11y webservice URL |
| `--pa11y-docker` | `-Pa11yDocker` | Create pa11y via Docker |
| `--no-seed` | `-NoSeed` | Skip baseline data seeding |
| `--non-interactive` | `-NonInteractive` | Skip all prompts |
| `--install-dir DIR` | `-InstallDir DIR` | Installation directory (default: ~/luqen) |
| `--with-monitor` | `-WithMonitor` | Install monitor agent |
| `--with-auth-entra` | `-WithAuthEntra` | Install Entra ID SSO plugin |
| `--with-notify-slack` | `-WithNotifySlack` | Install Slack plugin |
| `--with-notify-teams` | `-WithNotifyTeams` | Install Teams plugin |
| `--with-notify-email` | `-WithNotifyEmail` | Install Email plugin |
| `--with-storage-s3` | `-WithStorageS3` | Install S3 plugin |
| `--with-storage-azure` | `-WithStorageAzure` | Install Azure Blob plugin |
| `--with-all-plugins` | `-WithAllPlugins` | Install all plugins |

---

## Docker deployment templates

When using Docker mode, the installer uses pre-built docker-compose templates from `deploy/templates/`:

### Minimal

Compliance + Dashboard only. Bring your own pa11y webservice.

| Service | Included |
|---------|----------|
| Compliance | Yes |
| Dashboard | Yes |
| pa11y | No — provide via `LUQEN_WEBSERVICE_URL` |
| MongoDB | No |
| Redis | No |

Best for: existing infrastructure, development.

### Standard (recommended)

Full stack including pa11y webservice and Redis.

| Service | Included |
|---------|----------|
| Compliance | Yes |
| Dashboard | Yes |
| pa11y webservice | Yes |
| MongoDB | Yes (for pa11y) |
| Redis | Yes (SSE pub/sub, scan queue) |

Best for: team deployments, small organisations.

### Full

Standard plus monitor agent and increased concurrency.

| Service | Included |
|---------|----------|
| Everything in Standard | Yes |
| Monitor agent | Yes (watches legal sources for changes) |
| Redis-backed compliance cache | Yes |
| Max concurrent scans | 4 (vs 2 default) |

Best for: enterprise, production, organisations tracking multiple jurisdictions.

---

## Prerequisites

### Local Node.js

- Node.js 20+ (`node --version`)
- npm (`npm --version`)
- git (`git --version`)
- Optional: Docker (for pa11y webservice)

### Docker

- Docker 20+ with Docker Compose v2
- git
- 2 GB RAM minimum (4 GB recommended for Full template)

---

## Post-install

### Verify services

```bash
curl http://localhost:4000/api/v1/health   # Compliance
curl http://localhost:5000/health           # Dashboard
```

### Access the dashboard

Open `http://localhost:5000` in your browser.

- **If the wizard created an admin user:** log in with your username and password
- **Otherwise:** log in with the API key printed during installation

### First steps

1. Log in to the dashboard
2. Go to **Admin > Plugins** to configure any installed plugins (SMTP settings for email, Entra ID settings for SSO, etc.)
3. Run your first scan from **Scans > New Scan**
4. Review results in **Reports**

---

## Uninstall

### Local

```bash
rm -rf ~/luqen
```

### Docker

```bash
cd ~/luqen && docker compose down -v
rm -rf ~/luqen
```

### pa11y Docker (if created separately)

```bash
docker rm -f pa11y-webservice pa11y-mongo
docker volume rm pa11y-mongo-data
docker network rm luqen-net
```

---

*See also: [What is Luqen?](what-is-luqen.md) | [Quick scan](quick-scan.md) | [Docker deployment](../deployment/docker.md) | [Kubernetes](../deployment/kubernetes.md)*
