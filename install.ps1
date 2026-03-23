#Requires -Version 5.1
<#
.SYNOPSIS
    Luqen Installer for Windows (PowerShell)

.DESCRIPTION
    Interactive wizard to install Luqen, the enterprise accessibility testing platform.
    Creates Windows services via NSSM or Task Scheduler.

.EXAMPLE
    irm https://raw.githubusercontent.com/trunten82/luqen/master/install.ps1 | iex

.EXAMPLE
    .\install.ps1 -NonInteractive -Port 4000 -Pa11yUrl http://pa11y:3000
#>

[CmdletBinding()]
param(
    [int]$Port = 0,
    [string]$Pa11yUrl = "",
    [switch]$Pa11yDocker,
    [ValidateSet("sqlite","postgres","mongodb")]
    [string]$Db = "sqlite",
    [string]$DbUrl = "",
    [ValidateSet("none","entra","okta","google")]
    [string]$Auth = "none",
    [string]$AuthTenantId = "",
    [string]$AuthClientId = "",
    [string]$AuthClientSecret = "",
    [string]$AuthOrgUrl = "",
    [string]$AuthHostedDomain = "",
    [switch]$NoSeed,
    [switch]$NonInteractive,
    [string]$InstallDir = "",
    [switch]$WithMonitor,
    [switch]$WithNotifySlack,
    [switch]$WithNotifyTeams,
    [switch]$WithNotifyEmail,
    [switch]$WithStorageS3,
    [switch]$WithStorageAzure,
    [string]$SlackWebhookUrl = "",
    [string]$TeamsWebhookUrl = "",
    [string]$SmtpHost = "",
    [int]$SmtpPort = 587,
    [string]$SmtpUser = "",
    [string]$SmtpPass = "",
    [string]$SmtpFrom = "",
    [string]$AdminUser = "",
    [string]$AdminPass = ""
)

$ErrorActionPreference = "Stop"

# ──────────────────────────────────────────────
# Output helpers
# ──────────────────────────────────────────────
function Write-Info    { param([string]$Msg) Write-Host "  * " -ForegroundColor Cyan -NoNewline; Write-Host $Msg }
function Write-Ok      { param([string]$Msg) Write-Host "  + " -ForegroundColor Green -NoNewline; Write-Host $Msg -ForegroundColor Green }
function Write-Warn    { param([string]$Msg) Write-Host "  ! " -ForegroundColor Yellow -NoNewline; Write-Host $Msg -ForegroundColor Yellow }
function Write-Err     { param([string]$Msg) Write-Host "  X " -ForegroundColor Red -NoNewline; Write-Host $Msg -ForegroundColor Red }
function Write-Header  { param([string]$Msg) Write-Host ""; Write-Host "  $Msg" -ForegroundColor Cyan; Write-Host "" }
function Write-Step    { param([int]$N, [int]$Total, [string]$Msg) Write-Host ""; Write-Host "  [$N/$Total] $Msg" -ForegroundColor White }

function Invoke-Quiet {
    param([string]$Label, [scriptblock]$Action)
    Write-Host "  * $Label..." -ForegroundColor Cyan -NoNewline
    try {
        $null = & $Action 2>&1
        Write-Host "`r  + $Label   " -ForegroundColor Green
    } catch {
        Write-Host "`r  X $Label   " -ForegroundColor Red
        throw
    }
}

# ──────────────────────────────────────────────
# State
# ──────────────────────────────────────────────
$script:CompliancePort   = 4000
$script:DashboardPort    = 5000
$script:Pa11yUrlVal      = ""
$script:Pa11yDockerVal   = $false
$script:Pa11ySkip        = $false
$script:Seed             = $true
$script:Interactive      = $true
$script:RepoUrl          = "https://github.com/trunten82/luqen.git"
$script:InstallDirVal    = Join-Path $HOME "luqen"
$script:DbAdapter        = "sqlite"
$script:DbConnectionString = ""
$script:AuthProvider     = "none"
$script:AuthTenantIdVal  = ""
$script:AuthClientIdVal  = ""
$script:AuthClientSecretVal = ""
$script:AuthOrgUrlVal    = ""
$script:AuthHostedDomainVal = ""
$script:NotifySlack      = $false
$script:NotifyTeams      = $false
$script:NotifyEmail      = $false
$script:SlackWebhookUrlVal  = ""
$script:TeamsWebhookUrlVal  = ""
$script:SmtpHostVal      = ""
$script:SmtpPortVal      = 587
$script:SmtpUserVal      = ""
$script:SmtpPassVal      = ""
$script:SmtpFromVal      = ""
$script:StorageS3        = $false
$script:StorageAzure     = $false
$script:ModMonitor       = $false
$script:AdminUsername     = ""
$script:AdminPassword    = ""
$script:SessionSecret    = ""
$script:ClientId         = ""
$script:ClientSecret     = ""
$script:ApiKey           = ""
$script:ConfigFile       = ""
$script:TotalSteps       = 12

# ──────────────────────────────────────────────
# Apply parameters
# ──────────────────────────────────────────────
if ($Port -gt 0)       { $script:CompliancePort = $Port; $script:DashboardPort = $Port + 1000 }
if ($Pa11yUrl)         { $script:Pa11yUrlVal = $Pa11yUrl }
if ($Pa11yDocker)      { $script:Pa11yDockerVal = $true }
if ($Db)               { $script:DbAdapter = $Db }
if ($DbUrl)            { $script:DbConnectionString = $DbUrl }
if ($Auth)             { $script:AuthProvider = $Auth }
if ($AuthTenantId)     { $script:AuthTenantIdVal = $AuthTenantId }
if ($AuthClientId)     { $script:AuthClientIdVal = $AuthClientId }
if ($AuthClientSecret) { $script:AuthClientSecretVal = $AuthClientSecret }
if ($AuthOrgUrl)       { $script:AuthOrgUrlVal = $AuthOrgUrl }
if ($AuthHostedDomain) { $script:AuthHostedDomainVal = $AuthHostedDomain }
if ($NoSeed)           { $script:Seed = $false }
if ($NonInteractive)   { $script:Interactive = $false }
if ($InstallDir)       { $script:InstallDirVal = $InstallDir }
if ($WithMonitor)      { $script:ModMonitor = $true }
if ($WithNotifySlack)  { $script:NotifySlack = $true }
if ($WithNotifyTeams)  { $script:NotifyTeams = $true }
if ($WithNotifyEmail)  { $script:NotifyEmail = $true }
if ($WithStorageS3)    { $script:StorageS3 = $true }
if ($WithStorageAzure) { $script:StorageAzure = $true }
if ($SlackWebhookUrl)  { $script:SlackWebhookUrlVal = $SlackWebhookUrl }
if ($TeamsWebhookUrl)  { $script:TeamsWebhookUrlVal = $TeamsWebhookUrl }
if ($SmtpHost)         { $script:SmtpHostVal = $SmtpHost }
if ($SmtpPort -ne 587) { $script:SmtpPortVal = $SmtpPort }
if ($SmtpUser)         { $script:SmtpUserVal = $SmtpUser }
if ($SmtpPass)         { $script:SmtpPassVal = $SmtpPass }
if ($SmtpFrom)         { $script:SmtpFromVal = $SmtpFrom }
if ($AdminUser)        { $script:AdminUsername = $AdminUser }
if ($AdminPass)        { $script:AdminPassword = $AdminPass }

# ──────────────────────────────────────────────
# Validation helpers
# ──────────────────────────────────────────────
function Test-Pa11yUrl {
    param([string]$Url)
    try {
        $null = Invoke-RestMethod -Uri "$Url/api/tasks" -TimeoutSec 5 -ErrorAction Stop
        return $true
    } catch { return $false }
}

function Test-PostgresConnection {
    param([string]$ConnStr)
    $result = node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: '$ConnStr', connectionTimeoutMillis: 5000 });
        pool.query('SELECT 1').then(() => { pool.end(); process.exit(0); })
          .catch(() => process.exit(1));
    " 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Test-MongoConnection {
    param([string]$ConnStr)
    $result = node -e "
        const { MongoClient } = require('mongodb');
        const client = new MongoClient('$ConnStr', { serverSelectionTimeoutMS: 5000 });
        client.connect().then(() => client.close()).then(() => process.exit(0))
          .catch(() => process.exit(1));
    " 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Test-SmtpConnection {
    param([string]$Host, [int]$Port)
    $result = node -e "
        const net = require('net');
        const sock = net.createConnection({ host: '$Host', port: $Port, timeout: 5000 });
        sock.on('connect', () => { sock.destroy(); process.exit(0); });
        sock.on('error', () => process.exit(1));
        sock.on('timeout', () => { sock.destroy(); process.exit(1); });
    " 2>$null
    return ($LASTEXITCODE -eq 0)
}

# ──────────────────────────────────────────────
# Interactive prompt helpers
# ──────────────────────────────────────────────
function Read-Prompt {
    param([string]$Prompt, [string]$Default)
    Write-Host "  $Prompt [$Default]: " -NoNewline
    $input = Read-Host
    if ([string]::IsNullOrWhiteSpace($input)) { return $Default }
    return $input
}

function Read-Secret {
    param([string]$Prompt)
    Write-Host "  ${Prompt}: " -NoNewline
    $secure = Read-Host -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    return $plain
}

function Read-YesNo {
    param([string]$Prompt, [bool]$Default = $true)
    $hint = if ($Default) { "[Y/n]" } else { "[y/N]" }
    Write-Host "  $Prompt $hint: " -NoNewline
    $input = Read-Host
    if ([string]::IsNullOrWhiteSpace($input)) { return $Default }
    return $input -match "^[yY]"
}

function Read-Choice {
    param([string]$Prompt, [string[]]$Options)
    Write-Host ""
    Write-Host "  $Prompt" -ForegroundColor White
    for ($i = 0; $i -lt $Options.Count; $i++) {
        Write-Host "    $($i + 1)" -ForegroundColor Cyan -NoNewline
        Write-Host ") $($Options[$i])"
    }
    Write-Host "    Choice: " -NoNewline
    return Read-Host
}

# ──────────────────────────────────────────────
# INTERACTIVE WIZARD
# ──────────────────────────────────────────────
function Invoke-Wizard {
    Write-Host ""
    Write-Host "  +==========================================+" -ForegroundColor Cyan
    Write-Host "  |       Luqen Installation Wizard          |" -ForegroundColor Cyan
    Write-Host "  +==========================================+" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Enterprise accessibility testing platform"
    Write-Host ""

    # 3a: Components — pa11y
    Write-Header "Components"
    Write-Host "  Compliance service and Dashboard are always installed."
    Write-Host ""

    if (Read-YesNo "Include pa11y webservice (accessibility scan engine)?" $true) {
        $choice = Read-Choice "pa11y webservice setup:" @(
            "I have an existing pa11y instance (enter URL)"
            "Provision a new instance via Docker"
            "Skip - configure later"
        )
        switch ($choice) {
            "1" {
                $ok = $false
                for ($attempt = 1; $attempt -le 3; $attempt++) {
                    $script:Pa11yUrlVal = Read-Prompt "pa11y webservice URL" "http://localhost:3000"
                    Write-Host "  Validating pa11y endpoint... " -NoNewline -ForegroundColor DarkGray
                    if (Test-Pa11yUrl $script:Pa11yUrlVal) {
                        Write-Ok "reachable"
                        $ok = $true
                        break
                    }
                    Write-Warn "Could not reach $($script:Pa11yUrlVal)/api/tasks (attempt $attempt/3)"
                }
                if (-not $ok) {
                    Write-Err "pa11y URL validation failed. Set DASHBOARD_WEBSERVICE_URL later."
                    $script:Pa11yUrlVal = "http://localhost:3000"
                    $script:Pa11ySkip = $true
                }
            }
            "2" {
                $script:Pa11yDockerVal = $true
                $script:Pa11yUrlVal = "http://localhost:3000"
                Write-Ok "Will provision pa11y via Docker"
            }
            default {
                $script:Pa11yUrlVal = "http://localhost:3000"
                $script:Pa11ySkip = $true
                Write-Warn "Skipping pa11y - set DASHBOARD_WEBSERVICE_URL later"
            }
        }
    } else {
        $script:Pa11yUrlVal = "http://localhost:3000"
        $script:Pa11ySkip = $true
    }

    if (Read-YesNo "Include regulatory monitor agent?" $false) {
        $script:ModMonitor = $true
        Write-Ok "Monitor agent enabled"
    }

    # 3c: Database
    Write-Header "Database"
    Write-Host "  The dashboard needs a database for scan results, users, and settings."
    Write-Host ""

    $choice = Read-Choice "Database:" @(
        "SQLite (default - zero configuration)"
        "PostgreSQL (external server)"
        "MongoDB (external server)"
    )
    switch ($choice) {
        "2" {
            $script:DbAdapter = "postgres"
            $script:DbConnectionString = Read-Prompt "PostgreSQL connection URL" "postgres://localhost:5432/luqen"
            Write-Host "  Validating PostgreSQL connection... " -NoNewline -ForegroundColor DarkGray
            if (Test-PostgresConnection $script:DbConnectionString) {
                Write-Ok "connected"
            } else {
                Write-Err "Could not connect to PostgreSQL"
                if (-not (Read-YesNo "Continue anyway?" $false)) { exit 1 }
            }
        }
        "3" {
            $script:DbAdapter = "mongodb"
            $script:DbConnectionString = Read-Prompt "MongoDB connection URL" "mongodb://localhost:27017/luqen"
            Write-Host "  Validating MongoDB connection... " -NoNewline -ForegroundColor DarkGray
            if (Test-MongoConnection $script:DbConnectionString) {
                Write-Ok "connected"
            } else {
                Write-Err "Could not connect to MongoDB"
                if (-not (Read-YesNo "Continue anyway?" $false)) { exit 1 }
            }
        }
        default {
            $script:DbAdapter = "sqlite"
            Write-Ok "Using SQLite (no configuration needed)"
        }
    }

    # 3d: Authentication
    Write-Header "Authentication"
    Write-Host "  Choose how users will sign in."
    Write-Host ""

    $choice = Read-Choice "Identity provider:" @(
        "None - solo/team mode (API key + local accounts)"
        "Microsoft Entra ID (Azure AD SSO)"
        "Okta"
        "Google Workspace"
    )
    switch ($choice) {
        "2" {
            $script:AuthProvider = "entra"
            $script:AuthTenantIdVal = Read-Prompt "Entra tenant ID" ""
            $script:AuthClientIdVal = Read-Prompt "Entra client ID" ""
            $script:AuthClientSecretVal = Read-Secret "Entra client secret"
            if (-not $script:AuthTenantIdVal -or -not $script:AuthClientIdVal -or -not $script:AuthClientSecretVal) {
                Write-Err "All Entra fields are required"
                $script:AuthProvider = "none"
            } else { Write-Ok "Entra ID configured" }
        }
        "3" {
            $script:AuthProvider = "okta"
            $script:AuthOrgUrlVal = Read-Prompt "Okta org URL" "https://your-org.okta.com"
            $script:AuthClientIdVal = Read-Prompt "Okta client ID" ""
            $script:AuthClientSecretVal = Read-Secret "Okta client secret"
            if (-not $script:AuthOrgUrlVal -or -not $script:AuthClientIdVal -or -not $script:AuthClientSecretVal) {
                Write-Err "All Okta fields are required"
                $script:AuthProvider = "none"
            } else { Write-Ok "Okta configured" }
        }
        "4" {
            $script:AuthProvider = "google"
            $script:AuthClientIdVal = Read-Prompt "Google client ID" ""
            $script:AuthClientSecretVal = Read-Secret "Google client secret"
            $script:AuthHostedDomainVal = Read-Prompt "Hosted domain restriction (optional)" ""
            if (-not $script:AuthClientIdVal -or -not $script:AuthClientSecretVal) {
                Write-Err "Client ID and secret are required"
                $script:AuthProvider = "none"
            } else { Write-Ok "Google configured" }
        }
        default {
            $script:AuthProvider = "none"
            Write-Ok "Solo/team mode (API key login)"
        }
    }

    # 3e: Notifications
    Write-Header "Notifications"
    Write-Host "  Get notified when scans complete."
    Write-Host ""

    if (Read-YesNo "Slack notifications?" $false) {
        $script:NotifySlack = $true
        $script:SlackWebhookUrlVal = Read-Prompt "Slack webhook URL" ""
    }
    if (Read-YesNo "Teams notifications?" $false) {
        $script:NotifyTeams = $true
        $script:TeamsWebhookUrlVal = Read-Prompt "Teams webhook URL" ""
    }
    if (Read-YesNo "Email reports (SMTP)?" $false) {
        $script:NotifyEmail = $true
        $script:SmtpHostVal = Read-Prompt "SMTP host" ""
        $script:SmtpPortVal = [int](Read-Prompt "SMTP port" "587")
        $script:SmtpUserVal = Read-Prompt "SMTP username" ""
        $script:SmtpPassVal = Read-Secret "SMTP password"
        $script:SmtpFromVal = Read-Prompt "From address" ""
        Write-Host "  Validating SMTP connection... " -NoNewline -ForegroundColor DarkGray
        if (Test-SmtpConnection $script:SmtpHostVal $script:SmtpPortVal) {
            Write-Ok "SMTP reachable"
        } else {
            Write-Warn "Could not reach SMTP server - fix later in plugin settings"
        }
    }

    # 3f: Ports + dir
    Write-Header "Configuration"
    $script:CompliancePort = [int](Read-Prompt "Compliance service port" $script:CompliancePort)
    $script:DashboardPort = $script:CompliancePort + 1000
    $script:DashboardPort = [int](Read-Prompt "Dashboard port" $script:DashboardPort)
    $script:InstallDirVal = Read-Prompt "Installation directory" $script:InstallDirVal

    # 3g: Admin user
    Write-Header "Admin Account"
    Write-Host "  Create an admin user, or log in with the API key later."
    Write-Host ""

    if (Read-YesNo "Create an admin user now?" $true) {
        $script:AdminUsername = Read-Prompt "Admin username" "admin"
        while ($true) {
            $script:AdminPassword = Read-Secret "Admin password (min 8 chars)"
            if ($script:AdminPassword.Length -ge 8) { break }
            Write-Warn "Password must be at least 8 characters."
        }
        Write-Ok "Admin user will be created after install"
    }

    # Summary
    Write-Host ""
    Write-Host "  +------------------------------------------+" -ForegroundColor White
    Write-Host "  |          Installation Summary             |" -ForegroundColor White
    Write-Host "  +------------------------------------------+" -ForegroundColor White
    Write-Host ""

    $fmt = "  {0,-22} {1}"
    Write-Host ($fmt -f "Install directory:", $script:InstallDirVal)
    Write-Host ($fmt -f "Compliance port:", $script:CompliancePort)
    Write-Host ($fmt -f "Dashboard port:", $script:DashboardPort)
    Write-Host ($fmt -f "Database:", $script:DbAdapter)
    Write-Host ($fmt -f "Authentication:", $script:AuthProvider)
    Write-Host ($fmt -f "pa11y:", $(if ($script:Pa11ySkip) { "skipped" } else { $script:Pa11yUrlVal }))
    Write-Host ($fmt -f "Monitor:", $(if ($script:ModMonitor) { "yes" } else { "no" }))

    $notifs = @()
    if ($script:NotifySlack) { $notifs += "slack" }
    if ($script:NotifyTeams) { $notifs += "teams" }
    if ($script:NotifyEmail) { $notifs += "email" }
    $notifsStr = if ($notifs.Count -eq 0) { "none" } else { $notifs -join " " }
    Write-Host ($fmt -f "Notifications:", $notifsStr)

    if ($script:AdminUsername) { Write-Host ($fmt -f "Admin user:", $script:AdminUsername) }

    Write-Host ""
    if (-not (Read-YesNo "Proceed with installation?" $true)) {
        Write-Info "Installation cancelled."
        exit 0
    }
}

# ──────────────────────────────────────────────
# Step 1: Prerequisites
# ──────────────────────────────────────────────
function Test-Prerequisites {
    Write-Step 1 $script:TotalSteps "Checking prerequisites"

    $hasWinget = Get-Command winget -ErrorAction SilentlyContinue

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        if ($hasWinget) {
            Write-Info "Node.js not found. Installing via winget..."
            winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>$null | Out-Null
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        }
        if (-not $nodeCmd) {
            Write-Err "Node.js not found. Install Node.js 20+ from https://nodejs.org"
            exit 1
        }
    }
    $nodeVersion = (node -e "process.stdout.write(process.versions.node)") 2>$null
    $nodeMajor = [int]($nodeVersion -split '\.')[0]
    if ($nodeMajor -lt 20) {
        Write-Err "Node.js 20+ required. Found: v$nodeVersion"
        exit 1
    }

    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCmd) {
        if ($hasWinget) {
            Write-Info "Git not found. Installing via winget..."
            winget install Git.Git --accept-source-agreements --accept-package-agreements 2>$null | Out-Null
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            $gitCmd = Get-Command git -ErrorAction SilentlyContinue
        }
        if (-not $gitCmd) {
            Write-Err "git not found. Install from https://git-scm.com"
            exit 1
        }
    }

    Write-Ok "Node.js v$nodeVersion, npm $((npm --version) 2>$null), git $((git --version) -replace 'git version ','')"
}

# ──────────────────────────────────────────────
# Step 2: Clone / pull
# ──────────────────────────────────────────────
function Invoke-CloneOrPull {
    Write-Step 2 $script:TotalSteps "Fetching source code"

    $gitDir = Join-Path $script:InstallDirVal ".git"
    if (Test-Path $gitDir) {
        Invoke-Quiet "Pulling latest changes" { git -C $script:InstallDirVal pull --ff-only 2>&1 }
    } else {
        Invoke-Quiet "Cloning repository" { git clone $script:RepoUrl $script:InstallDirVal 2>&1 }
    }
}

# ──────────────────────────────────────────────
# Step 4: Install & build
# ──────────────────────────────────────────────
function Install-AndBuild {
    Write-Step 4 $script:TotalSteps "Installing dependencies and building"

    Push-Location $script:InstallDirVal
    try {
        Invoke-Quiet "Installing npm dependencies" { npm install --prefer-offline 2>&1 }
        Invoke-Quiet "Building packages" { npm run build --workspaces 2>&1 }
    } finally { Pop-Location }
}

# ──────────────────────────────────────────────
# Step 5: Generate secrets
# ──────────────────────────────────────────────
function New-Secrets {
    Write-Step 5 $script:TotalSteps "Generating secrets"

    $keysDir = Join-Path $script:InstallDirVal "packages\compliance\keys"
    if (Test-Path (Join-Path $keysDir "private.pem")) {
        Write-Info "JWT keys already exist - reusing"
    } else {
        New-Item -ItemType Directory -Path $keysDir -Force | Out-Null
        Push-Location (Join-Path $script:InstallDirVal "packages\compliance")
        node dist/cli.js keys generate 2>&1 | Out-Null
        Pop-Location
        Write-Ok "JWT RS256 key pair generated"
    }

    $script:SessionSecret = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    Write-Ok "Session secret generated"
}

# ──────────────────────────────────────────────
# Step 6: Seed data
# ──────────────────────────────────────────────
function Invoke-Seed {
    Write-Step 6 $script:TotalSteps "Seeding compliance data"

    if ($script:Seed) {
        Push-Location (Join-Path $script:InstallDirVal "packages\compliance")
        Invoke-Quiet "Seeding jurisdictions and regulations" { node dist/cli.js seed 2>&1 }
        Pop-Location
    } else {
        Write-Info "Seeding skipped (-NoSeed)"
    }
}

# ──────────────────────────────────────────────
# Step 7: OAuth client
# ──────────────────────────────────────────────
function New-OAuthClient {
    Write-Step 7 $script:TotalSteps "Creating OAuth client"

    $clientCache = Join-Path $script:InstallDirVal ".install-client"
    if (Test-Path $clientCache) {
        $cacheContent = Get-Content $clientCache
        foreach ($line in $cacheContent) {
            if ($line -match "^client_id=(.+)$")     { $script:ClientId = $Matches[1] }
            if ($line -match "^client_secret=(.+)$") { $script:ClientSecret = $Matches[1] }
        }
        Write-Info "OAuth client already exists - reusing"
    } else {
        Push-Location (Join-Path $script:InstallDirVal "packages\compliance")
        $clientOut = node dist/cli.js clients create --name "luqen-dashboard" --scope "read write" 2>&1
        Pop-Location
        foreach ($line in $clientOut) {
            if ($line -match "client_id:\s*(\S+)")     { $script:ClientId = $Matches[1] }
            if ($line -match "client_secret:\s*(\S+)") { $script:ClientSecret = $Matches[1] }
        }
        Set-Content -Path $clientCache -Value "client_id=$($script:ClientId)`nclient_secret=$($script:ClientSecret)" -Encoding UTF8
        Write-Ok "OAuth client created"
    }
}

# ──────────────────────────────────────────────
# Step 8: Write config
# ──────────────────────────────────────────────
function Write-Config {
    Write-Step 8 $script:TotalSteps "Writing configuration"

    $script:ConfigFile = Join-Path $script:InstallDirVal "dashboard.config.json"

    $config = @{
        port                   = $script:DashboardPort
        complianceUrl          = "http://localhost:$($script:CompliancePort)"
        webserviceUrl          = $script:Pa11yUrlVal
        sessionSecret          = $script:SessionSecret
        complianceClientId     = $script:ClientId
        complianceClientSecret = $script:ClientSecret
        reportsDir             = "./reports"
        pluginsDir             = "./plugins"
    }

    if ($script:DbAdapter -eq "postgres") {
        $config["dbAdapter"] = "postgres"
        $config["dbUrl"] = $script:DbConnectionString
    }
    if ($script:DbAdapter -eq "mongodb") {
        $config["dbAdapter"] = "mongodb"
        $config["dbUrl"] = $script:DbConnectionString
    }

    $config | ConvertTo-Json -Depth 3 | Set-Content -Path $script:ConfigFile -Encoding UTF8
    Write-Ok "dashboard.config.json written"
}

# ──────────────────────────────────────────────
# Step 9: Install plugins (called from step 11)
# ──────────────────────────────────────────────
function Install-LuqenPlugin {
    param([string]$PackageName, [string]$Label)
    $baseUrl = "http://localhost:$($script:DashboardPort)"
    try {
        $body = @{ packageName = $PackageName } | ConvertTo-Json
        $null = Invoke-RestMethod -Uri "$baseUrl/api/v1/plugins/install" `
            -Method Post `
            -Headers @{ Authorization = "Bearer $($script:ApiKey)"; "Content-Type" = "application/json" } `
            -Body $body -TimeoutSec 30 -ErrorAction Stop
        Write-Ok "  $Label"
    } catch {
        Write-Warn "  ${Label}: skipped"
    }
}

function Set-PluginConfig {
    param([string]$PluginId, [hashtable]$Config)
    $baseUrl = "http://localhost:$($script:DashboardPort)"
    try {
        $body = $Config | ConvertTo-Json
        $null = Invoke-RestMethod -Uri "$baseUrl/api/v1/plugins/$PluginId/config" `
            -Method Put `
            -Headers @{ Authorization = "Bearer $($script:ApiKey)"; "Content-Type" = "application/json" } `
            -Body $body -TimeoutSec 15 -ErrorAction SilentlyContinue
    } catch {}
}

function Invoke-InstallPlugins {
    Write-Step 9 $script:TotalSteps "Installing plugins"

    $anyPlugin = $false

    if ($script:AuthProvider -eq "entra") {
        Install-LuqenPlugin "@luqen/plugin-auth-entra" "Entra ID SSO"
        Set-PluginConfig "auth-entra" @{ tenantId = $script:AuthTenantIdVal; clientId = $script:AuthClientIdVal; clientSecret = $script:AuthClientSecretVal }
        $anyPlugin = $true
    }
    if ($script:AuthProvider -eq "okta") {
        Install-LuqenPlugin "@luqen/plugin-auth-okta" "Okta SSO"
        Set-PluginConfig "auth-okta" @{ orgUrl = $script:AuthOrgUrlVal; clientId = $script:AuthClientIdVal; clientSecret = $script:AuthClientSecretVal }
        $anyPlugin = $true
    }
    if ($script:AuthProvider -eq "google") {
        Install-LuqenPlugin "@luqen/plugin-auth-google" "Google SSO"
        $gc = @{ clientId = $script:AuthClientIdVal; clientSecret = $script:AuthClientSecretVal }
        if ($script:AuthHostedDomainVal) { $gc["hostedDomain"] = $script:AuthHostedDomainVal }
        Set-PluginConfig "auth-google" $gc
        $anyPlugin = $true
    }

    if ($script:NotifySlack) {
        Install-LuqenPlugin "@luqen/plugin-notify-slack" "Slack notifications"
        if ($script:SlackWebhookUrlVal) { Set-PluginConfig "notify-slack" @{ webhookUrl = $script:SlackWebhookUrlVal } }
        $anyPlugin = $true
    }
    if ($script:NotifyTeams) {
        Install-LuqenPlugin "@luqen/plugin-notify-teams" "Teams notifications"
        if ($script:TeamsWebhookUrlVal) { Set-PluginConfig "notify-teams" @{ webhookUrl = $script:TeamsWebhookUrlVal } }
        $anyPlugin = $true
    }
    if ($script:NotifyEmail) {
        Install-LuqenPlugin "@luqen/plugin-notify-email" "Email reports"
        if ($script:SmtpHostVal) {
            Set-PluginConfig "notify-email" @{
                host = $script:SmtpHostVal; port = $script:SmtpPortVal
                username = $script:SmtpUserVal; password = $script:SmtpPassVal; from = $script:SmtpFromVal
            }
        }
        $anyPlugin = $true
    }

    if ($script:StorageS3) { Install-LuqenPlugin "@luqen/plugin-storage-s3" "AWS S3 storage"; $anyPlugin = $true }
    if ($script:StorageAzure) { Install-LuqenPlugin "@luqen/plugin-storage-azure" "Azure Blob storage"; $anyPlugin = $true }

    if ($script:DbAdapter -eq "postgres") {
        Install-LuqenPlugin "@luqen/plugin-storage-postgres" "PostgreSQL adapter"
        Set-PluginConfig "storage-postgres" @{ connectionString = $script:DbConnectionString }
        $anyPlugin = $true
    }
    if ($script:DbAdapter -eq "mongodb") {
        Install-LuqenPlugin "@luqen/plugin-storage-mongodb" "MongoDB adapter"
        Set-PluginConfig "storage-mongodb" @{ connectionString = $script:DbConnectionString }
        $anyPlugin = $true
    }

    if (-not $anyPlugin) { Write-Info "No plugins selected" }
}

# ──────────────────────────────────────────────
# Step 10: Create Windows services
# ──────────────────────────────────────────────
function New-WindowsServices {
    Write-Step 10 $script:TotalSteps "Creating Windows services"

    $nodePath = (Get-Command node).Source
    $nssmPath = Get-Command nssm -ErrorAction SilentlyContinue

    if ($nssmPath) {
        # Use NSSM for proper Windows services
        Write-Info "Using NSSM to create services..."

        # Compliance service
        & nssm install "LuqenCompliance" "$nodePath" "dist/cli.js serve --port $($script:CompliancePort)" 2>$null | Out-Null
        & nssm set "LuqenCompliance" AppDirectory (Join-Path $script:InstallDirVal "packages\compliance") 2>$null | Out-Null
        & nssm set "LuqenCompliance" Description "Luqen Compliance Service" 2>$null | Out-Null
        & nssm set "LuqenCompliance" Start SERVICE_AUTO_START 2>$null | Out-Null
        & nssm set "LuqenCompliance" AppEnvironmentExtra "NODE_ENV=production" "COMPLIANCE_PORT=$($script:CompliancePort)" 2>$null | Out-Null

        # Dashboard service
        & nssm install "LuqenDashboard" "$nodePath" "dist/cli.js serve --config $($script:ConfigFile)" 2>$null | Out-Null
        & nssm set "LuqenDashboard" AppDirectory (Join-Path $script:InstallDirVal "packages\dashboard") 2>$null | Out-Null
        & nssm set "LuqenDashboard" Description "Luqen Dashboard" 2>$null | Out-Null
        & nssm set "LuqenDashboard" Start SERVICE_AUTO_START 2>$null | Out-Null
        & nssm set "LuqenDashboard" DependOnService "LuqenCompliance" 2>$null | Out-Null
        & nssm set "LuqenDashboard" AppEnvironmentExtra `
            "NODE_ENV=production" `
            "DASHBOARD_SESSION_SECRET=$($script:SessionSecret)" `
            "DASHBOARD_COMPLIANCE_URL=http://localhost:$($script:CompliancePort)" `
            "DASHBOARD_WEBSERVICE_URL=$($script:Pa11yUrlVal)" `
            "DASHBOARD_COMPLIANCE_CLIENT_ID=$($script:ClientId)" `
            "DASHBOARD_COMPLIANCE_CLIENT_SECRET=$($script:ClientSecret)" 2>$null | Out-Null

        Write-Ok "NSSM services created (LuqenCompliance, LuqenDashboard)"
    } else {
        # Fallback: Task Scheduler
        Write-Info "NSSM not found — using Task Scheduler..."

        $compArgs = "dist/cli.js serve --port $($script:CompliancePort)"
        $compAction = New-ScheduledTaskAction -Execute $nodePath -Argument $compArgs `
            -WorkingDirectory (Join-Path $script:InstallDirVal "packages\compliance")
        $compTrigger = New-ScheduledTaskTrigger -AtStartup
        $compSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName "LuqenCompliance" -Action $compAction -Trigger $compTrigger `
            -Settings $compSettings -Description "Luqen Compliance Service" -User "SYSTEM" -Force 2>$null | Out-Null

        $dashArgs = "dist/cli.js serve --config $($script:ConfigFile)"
        $dashAction = New-ScheduledTaskAction -Execute $nodePath -Argument $dashArgs `
            -WorkingDirectory (Join-Path $script:InstallDirVal "packages\dashboard")
        $dashTrigger = New-ScheduledTaskTrigger -AtStartup
        $dashSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName "LuqenDashboard" -Action $dashAction -Trigger $dashTrigger `
            -Settings $dashSettings -Description "Luqen Dashboard" -User "SYSTEM" -Force 2>$null | Out-Null

        Write-Ok "Scheduled tasks created (LuqenCompliance, LuqenDashboard)"
    }
}

# ──────────────────────────────────────────────
# Pa11y Docker setup
# ──────────────────────────────────────────────
function Initialize-Pa11yDocker {
    if (-not $script:Pa11yDockerVal) { return }

    Write-Info "Setting up pa11y webservice via Docker..."

    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Err "Docker is required for pa11y provisioning but not found"
        return
    }

    $running = docker ps --format "{{.Names}}" 2>$null | Where-Object { $_ -eq "pa11y-webservice" }
    if ($running) { Write-Info "pa11y-webservice already running"; return }

    docker network create luqen-net 2>$null | Out-Null
    docker run -d --name pa11y-mongo --network luqen-net --restart unless-stopped -v pa11y-mongo-data:/data/db mongo:7 2>$null | Out-Null
    docker run -d --name pa11y-webservice --network luqen-net --restart unless-stopped -p 3000:3000 -e "DATABASE=mongodb://pa11y-mongo:27017/pa11y-webservice" pa11y/pa11y-webservice 2>$null | Out-Null

    Write-Info "Waiting for pa11y webservice..."
    $attempts = 0
    while ($true) {
        try {
            $null = Invoke-RestMethod -Uri "http://localhost:3000/api/tasks" -TimeoutSec 2 -ErrorAction Stop
            break
        } catch {
            $attempts++
            if ($attempts -ge 20) { Write-Err "pa11y did not start. Check: docker logs pa11y-webservice"; return }
            Start-Sleep -Seconds 2
        }
    }
    Write-Ok "pa11y webservice running at http://localhost:3000"
}

# ──────────────────────────────────────────────
# Step 11: Start services + post-install
# ──────────────────────────────────────────────
function Start-LuqenServices {
    Write-Step 11 $script:TotalSteps "Starting services"

    $nssmPath = Get-Command nssm -ErrorAction SilentlyContinue

    if ($nssmPath) {
        & nssm start "LuqenCompliance" 2>$null | Out-Null
    } else {
        Start-ScheduledTask -TaskName "LuqenCompliance" -ErrorAction SilentlyContinue
    }

    # Also start directly for post-install tasks
    $compLogFile = Join-Path $env:TEMP "luqen-comp-install.log"
    $dashLogFile = Join-Path $env:TEMP "luqen-dash-install.log"

    $env:COMPLIANCE_API_KEY = "setup-temp-key"
    $env:COMPLIANCE_PORT = $script:CompliancePort
    $compProcess = Start-Process -FilePath (Get-Command node).Source `
        -ArgumentList "dist/cli.js", "serve", "--port", $script:CompliancePort `
        -WorkingDirectory (Join-Path $script:InstallDirVal "packages\compliance") `
        -RedirectStandardOutput $compLogFile `
        -RedirectStandardError (Join-Path $env:TEMP "luqen-comp-err.log") `
        -PassThru -WindowStyle Hidden

    Start-Sleep -Seconds 3

    Write-Info "Waiting for compliance service..."
    $attempts = 0
    while ($true) {
        try {
            $null = Invoke-RestMethod -Uri "http://localhost:$($script:CompliancePort)/health" -TimeoutSec 2 -ErrorAction Stop
            break
        } catch {
            $attempts++
            if ($attempts -ge 15) { Write-Err "Compliance did not start"; break }
            Start-Sleep -Seconds 2
        }
    }
    Write-Ok "Compliance service running"

    $env:DASHBOARD_SESSION_SECRET = $script:SessionSecret
    $env:DASHBOARD_COMPLIANCE_URL = "http://localhost:$($script:CompliancePort)"
    $env:DASHBOARD_COMPLIANCE_API_KEY = "setup-temp-key"
    $env:DASHBOARD_WEBSERVICE_URL = $script:Pa11yUrlVal
    $env:DASHBOARD_COMPLIANCE_CLIENT_ID = $script:ClientId
    $env:DASHBOARD_COMPLIANCE_CLIENT_SECRET = $script:ClientSecret

    $dashProcess = Start-Process -FilePath (Get-Command node).Source `
        -ArgumentList "dist/cli.js", "serve", "--port", $script:DashboardPort `
        -WorkingDirectory (Join-Path $script:InstallDirVal "packages\dashboard") `
        -RedirectStandardOutput $dashLogFile `
        -RedirectStandardError (Join-Path $env:TEMP "luqen-dash-err.log") `
        -PassThru -WindowStyle Hidden

    Start-Sleep -Seconds 4

    Write-Info "Waiting for dashboard..."
    $attempts = 0
    while ($true) {
        try {
            $null = Invoke-RestMethod -Uri "http://localhost:$($script:DashboardPort)/health" -TimeoutSec 2 -ErrorAction Stop
            break
        } catch {
            $attempts++
            if ($attempts -ge 15) { Write-Err "Dashboard did not start"; break }
            Start-Sleep -Seconds 2
        }
    }
    Write-Ok "Dashboard running"

    # Grab API key
    if (Test-Path $dashLogFile) {
        $dashLog = Get-Content $dashLogFile -Raw
        if ($dashLog -match "API Key: ([a-f0-9]{64})") {
            $script:ApiKey = $Matches[1]
        }
    }

    # Create admin user
    if ($script:ApiKey -and $script:AdminUsername) {
        try {
            $body = @{ username = $script:AdminUsername; password = $script:AdminPassword; role = "admin" } | ConvertTo-Json
            $null = Invoke-RestMethod -Uri "http://localhost:$($script:DashboardPort)/api/v1/setup" `
                -Method Post -Headers @{ Authorization = "Bearer $($script:ApiKey)"; "Content-Type" = "application/json" } `
                -Body $body -TimeoutSec 15 -ErrorAction Stop
            Write-Ok "Admin user '$($script:AdminUsername)' created"
        } catch {
            Write-Warn "Could not create admin user"
        }
    }

    # Install plugins
    if ($script:ApiKey) {
        Invoke-InstallPlugins
    } else {
        Write-Warn "Could not retrieve API key - skipping plugin installation"
    }

    # Stop temp processes (services are running via NSSM/Task Scheduler)
    try { Stop-Process -Id $compProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
    try { Stop-Process -Id $dashProcess.Id -Force -ErrorAction SilentlyContinue } catch {}

    # Start services properly
    if ($nssmPath) {
        & nssm start "LuqenDashboard" 2>$null | Out-Null
    } else {
        Start-ScheduledTask -TaskName "LuqenDashboard" -ErrorAction SilentlyContinue
    }

    # Clean up env vars
    @("COMPLIANCE_API_KEY","COMPLIANCE_PORT","DASHBOARD_SESSION_SECRET","DASHBOARD_COMPLIANCE_URL",
      "DASHBOARD_COMPLIANCE_API_KEY","DASHBOARD_WEBSERVICE_URL","DASHBOARD_COMPLIANCE_CLIENT_ID",
      "DASHBOARD_COMPLIANCE_CLIENT_SECRET") | ForEach-Object {
        Remove-Item "Env:\$_" -ErrorAction SilentlyContinue
    }
}

# ──────────────────────────────────────────────
# Step 12: Summary
# ──────────────────────────────────────────────
function Show-Summary {
    Write-Step 12 $script:TotalSteps "Installation complete"

    Write-Host ""
    Write-Host "  +==========================================+" -ForegroundColor Green
    Write-Host "  |      Luqen installed successfully!       |" -ForegroundColor Green
    Write-Host "  +==========================================+" -ForegroundColor Green
    Write-Host ""
    Write-Host "  URLs:" -ForegroundColor White
    Write-Host "    Dashboard:   " -NoNewline; Write-Host "http://localhost:$($script:DashboardPort)" -ForegroundColor Cyan
    Write-Host "    Compliance:  " -NoNewline; Write-Host "http://localhost:$($script:CompliancePort)" -ForegroundColor Cyan
    Write-Host "    pa11y:       $($script:Pa11yUrlVal)"
    Write-Host ""

    if ($script:AdminUsername) {
        Write-Host "  Login:" -ForegroundColor White
        Write-Host "    Username:  $($script:AdminUsername)"
        Write-Host "    Password:  (the password you entered)"
        Write-Host ""
    }

    if ($script:ApiKey) {
        Write-Host "  API Key: (save this - also works for login)" -ForegroundColor White
        Write-Host "    $($script:ApiKey)" -ForegroundColor Yellow
        Write-Host ""
    }

    Write-Host "  Config:  $($script:ConfigFile)"
    Write-Host ""

    $nssmPath = Get-Command nssm -ErrorAction SilentlyContinue
    if ($nssmPath) {
        Write-Host "  Service management:" -ForegroundColor White
        Write-Host "    nssm status LuqenCompliance"
        Write-Host "    nssm status LuqenDashboard"
        Write-Host "    nssm restart LuqenCompliance"
        Write-Host "    nssm restart LuqenDashboard"
    } else {
        Write-Host "  Service management (Task Scheduler):" -ForegroundColor White
        Write-Host "    Get-ScheduledTask -TaskName 'Luqen*'"
        Write-Host "    Start-ScheduledTask -TaskName 'LuqenDashboard'"
        Write-Host "    Stop-ScheduledTask -TaskName 'LuqenDashboard'"
    }
    Write-Host ""
}

# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

if ($script:Interactive -and -not $NonInteractive -and [Environment]::UserInteractive) {
    Invoke-Wizard
}

# Apply defaults
if ([string]::IsNullOrEmpty($script:Pa11yUrlVal)) { $script:Pa11yUrlVal = "http://localhost:3000" }

# Execute steps
Test-Prerequisites         # Step 1
Invoke-CloneOrPull         # Step 2
                           # Step 3 was the wizard
Initialize-Pa11yDocker     # Step 3b
Install-AndBuild           # Step 4
New-Secrets                # Step 5
Invoke-Seed                # Step 6
New-OAuthClient            # Step 7
Write-Config               # Step 8
                           # Step 9 plugins in step 11
New-WindowsServices        # Step 10
Start-LuqenServices        # Step 11
Show-Summary               # Step 12
