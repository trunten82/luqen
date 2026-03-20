[Docs](../README.md) > [Installation](./) > One-line installer

# One-line Installer

Install pally-agent core with a single curl command.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/your-org/pally-agent/master/install.sh | bash
```

This script:
1. Detects your Node.js version (requires 18+)
2. Clones the monorepo to `~/.pally-agent`
3. Runs `npm install` and `npm run build --workspaces`
4. Symlinks `pally-agent` to `/usr/local/bin/pally-agent`

After installation:

```bash
pally-agent --version
export PALLY_WEBSERVICE_URL=http://localhost:3000
pally-agent scan https://example.com
```

---

## Uninstall

```bash
rm /usr/local/bin/pally-agent
rm -rf ~/.pally-agent
```

---

## Manual alternative

If you prefer not to pipe to bash, clone and install manually:

```bash
git clone https://github.com/your-org/pally-agent.git ~/.pally-agent
cd ~/.pally-agent
npm install
npm run build --workspaces
cd packages/core && npm link
```

---

*See also: [installation/local.md](local.md) | [QUICKSTART.md](../QUICKSTART.md)*
