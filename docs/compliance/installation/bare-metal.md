# Bare-Metal Installation (Linux / macOS)

Install and run the Pally Compliance Service directly on a Linux or macOS host without containers.

## System requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Node.js | 20.x LTS | 22.x LTS |
| npm | 10.x | 10.x+ |
| OS | Ubuntu 22.04 / macOS 13 | Ubuntu 24.04 / macOS 14+ |
| RAM | 256 MB | 512 MB |
| Disk | 500 MB (with Node.js) | 2 GB |

## Step-by-step installation

### Step 1: Install Node.js 20

**Ubuntu / Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # should print v20.x.x
```

**macOS (using Homebrew):**
```bash
brew install node@20
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node --version
```

**Any OS (using nvm):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 20
nvm use 20
node --version
```

### Step 2: Clone the repository and build

```bash
# Clone
git clone https://github.com/your-org/pally-agent.git /opt/pally-agent
cd /opt/pally-agent

# Install all workspace dependencies
npm ci

# Build the compliance package
cd packages/compliance
npm run build

# Verify build
ls dist/cli.js
```

### Step 3: Link the CLI (optional but recommended)

```bash
npm link
pally-compliance --version  # should print 0.1.0
```

Alternatively, run as `node /opt/pally-agent/packages/compliance/dist/cli.js`.

### Step 4: Create data and config directories

```bash
# Create a dedicated user (Linux)
sudo useradd -r -s /bin/false -d /var/lib/pally-compliance compliance-svc

# Create directories
sudo mkdir -p /etc/pally-compliance /var/lib/pally-compliance/keys /var/lib/pally-compliance/data
sudo chown -R compliance-svc:compliance-svc /var/lib/pally-compliance

# Set tight permissions on keys directory
sudo chmod 700 /var/lib/pally-compliance/keys
```

### Step 5: Generate JWT keys

```bash
cd /opt/pally-agent/packages/compliance
sudo -u compliance-svc COMPLIANCE_DB_PATH=/var/lib/pally-compliance/data/compliance.db \
  node dist/cli.js keys generate

# Move keys to the keys directory
sudo mv ./keys/private.pem /var/lib/pally-compliance/keys/
sudo mv ./keys/public.pem /var/lib/pally-compliance/keys/
sudo chmod 600 /var/lib/pally-compliance/keys/private.pem
sudo chown compliance-svc:compliance-svc /var/lib/pally-compliance/keys/*
```

### Step 6: Create the config file

```bash
sudo tee /etc/pally-compliance/compliance.config.json <<'EOF'
{
  "port": 4000,
  "host": "127.0.0.1",
  "dbAdapter": "sqlite",
  "dbPath": "/var/lib/pally-compliance/data/compliance.db",
  "jwtKeyPair": {
    "publicKeyPath": "/var/lib/pally-compliance/keys/public.pem",
    "privateKeyPath": "/var/lib/pally-compliance/keys/private.pem"
  },
  "tokenExpiry": "1h",
  "rateLimit": {
    "read": 100,
    "write": 20,
    "windowMs": 60000
  },
  "cors": {
    "origin": ["https://your-frontend.example.com"],
    "credentials": true
  }
}
EOF
sudo chown compliance-svc:compliance-svc /etc/pally-compliance/compliance.config.json
```

### Step 7: Seed the baseline data

```bash
cd /opt/pally-agent/packages/compliance
sudo -u compliance-svc node dist/cli.js seed
```

### Step 8: Create an OAuth client

```bash
cd /opt/pally-agent/packages/compliance
sudo -u compliance-svc node dist/cli.js clients create \
  --name "pally-agent" \
  --scope "read" \
  --grant client_credentials
```

Save the `client_id` and `client_secret`.

### Step 9: Test the server

```bash
# Start manually first to verify
cd /opt/pally-agent/packages/compliance
sudo -u compliance-svc node dist/cli.js serve

# In another terminal
curl http://localhost:4000/api/v1/health
```

Expected: `{"status":"ok","version":"0.1.0","timestamp":"..."}`

Stop with Ctrl-C, then proceed to set up the systemd service.

## Systemd service

Create `/etc/systemd/system/pally-compliance.service`:

```ini
[Unit]
Description=Pally Compliance Service
Documentation=https://github.com/your-org/pally-agent/tree/main/docs/compliance
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=compliance-svc
Group=compliance-svc

WorkingDirectory=/opt/pally-agent/packages/compliance
ExecStart=/usr/bin/node dist/cli.js serve
ExecReload=/bin/kill -HUP $MAINPID

# Config via environment
Environment=NODE_ENV=production
Environment=COMPLIANCE_DB_PATH=/var/lib/pally-compliance/data/compliance.db
Environment=COMPLIANCE_JWT_PRIVATE_KEY=/var/lib/pally-compliance/keys/private.pem
Environment=COMPLIANCE_JWT_PUBLIC_KEY=/var/lib/pally-compliance/keys/public.pem

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pally-compliance

# Security hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes
ReadWritePaths=/var/lib/pally-compliance/data

# Restart policy
Restart=on-failure
RestartSec=5s
StartLimitInterval=60s
StartLimitBurst=3

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pally-compliance
sudo systemctl start pally-compliance
sudo systemctl status pally-compliance
```

View logs:

```bash
journalctl -u pally-compliance -f
journalctl -u pally-compliance --since "1 hour ago"
```

## Nginx reverse proxy

The compliance service binds to `127.0.0.1:4000` by default. Use Nginx as a reverse proxy to expose it publicly with TLS.

### Install Nginx and Certbot

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### Nginx configuration

Create `/etc/nginx/sites-available/pally-compliance`:

```nginx
server {
    listen 80;
    server_name compliance.example.com;
    # Redirect HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name compliance.example.com;

    ssl_certificate /etc/letsencrypt/live/compliance.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/compliance.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;

    # Proxy to compliance service
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }

    # SSE support (A2A streaming)
    location /a2a/tasks {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/pally-compliance /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Obtain TLS certificate

```bash
sudo certbot --nginx -d compliance.example.com
```

### Update config for public URL

Update `/etc/pally-compliance/compliance.config.json`:

```json
{
  "cors": {
    "origin": ["https://your-frontend.example.com"],
    "credentials": true
  }
}
```

And set the A2A agent card URL:

```ini
# In /etc/systemd/system/pally-compliance.service
Environment=COMPLIANCE_URL=https://compliance.example.com
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart pally-compliance
```

## Updating

```bash
# Pull new code
cd /opt/pally-agent
git pull

# Rebuild
cd packages/compliance
npm ci
npm run build

# Restart service
sudo systemctl restart pally-compliance
```

## macOS-specific notes

On macOS, use `launchd` instead of systemd. Create `~/Library/LaunchAgents/com.pally.compliance.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.pally.compliance</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/opt/pally-agent/packages/compliance/dist/cli.js</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/opt/pally-agent/packages/compliance</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>COMPLIANCE_DB_PATH</key>
    <string>/var/lib/pally-compliance/compliance.db</string>
    <key>COMPLIANCE_JWT_PRIVATE_KEY</key>
    <string>/var/lib/pally-compliance/keys/private.pem</string>
    <key>COMPLIANCE_JWT_PUBLIC_KEY</key>
    <string>/var/lib/pally-compliance/keys/public.pem</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/pally-compliance.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/pally-compliance.error.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.pally.compliance.plist
launchctl start com.pally.compliance
```
