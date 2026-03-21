[Docs](../README.md) > [Getting Started](./) > One-line Install

# One-line Installer

Install the full luqen platform with a single command.

---

## What it does

The installer clones the monorepo, builds all 4 packages (core, compliance, dashboard, monitor), generates JWT keys, seeds the compliance database with 58 jurisdictions and 62 regulations, and creates a default OAuth2 client.

---

## Install

**Local (Node.js):**
```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash
```

**Docker:**
```bash
curl -fsSL https://raw.githubusercontent.com/trunten82/luqen/master/install.sh | bash -s -- --docker
```

Options: `--port PORT` (compliance port, dashboard = port+1000), `--pa11y-url URL`, `--no-seed`.

---

## Verify

```bash
luqen --version                    # Core CLI
curl http://localhost:4000/api/v1/health # Compliance (after starting serve)
curl http://localhost:5000/health        # Dashboard (after starting serve)
```

---

## Access the dashboard

Open `http://localhost:5000` in your browser. The OAuth2 credentials printed by the installer are saved to `~/luqen/.install-client`.

---

## Uninstall

```bash
rm -rf ~/luqen
```

For Docker mode, stop containers first: `cd ~/luqen && docker compose down -v`.

---

*See also: [What is Luqen?](what-is-luqen.md) | [Quick scan](quick-scan.md) | [Full dashboard setup](../paths/full-dashboard.md)*
