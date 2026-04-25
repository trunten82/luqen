#Requires -Version 5.1
# Last reviewed for v3.1.0 (Phase 40 / DOC-03) -- head migration 061
<#
.SYNOPSIS
    Luqen Installer for Windows (PowerShell)

.DESCRIPTION
    Interactive wizard to install Luqen with two deployment modes:
    1. Bare metal (Node.js + Windows services via NSSM/Task Scheduler)
    2. Docker Compose (everything in containers)

.EXAMPLE
    irm https://raw.githubusercontent.com/trunten82/luqen/master/install.ps1 | iex

.EXAMPLE
    .\install.ps1 -NonInteractive -Mode docker -Port 4000
#>

[CmdletBinding()]
param(
    [ValidateSet("bare-metal","docker")]
    [string]$Mode = "",
    [int]$Port = 0,
    [string]$Pa11yUrl = "",
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
    [switch]$WithNotifySlack,
    [switch]$WithNotifyTeams,
    [switch]$WithNotifyEmail,
    [string]$SlackWebhookUrl = "",
    [string]$TeamsWebhookUrl = "",
    [string]$SmtpHost = "",
    [int]$SmtpPort = 587,
    [string]$SmtpUser = "",
    [string]$SmtpPass = "",
    [string]$SmtpFrom = "",
    [string]$AdminUser = "",
    [string]$AdminPass = "",
    [switch]$Uninstall,
    [switch]$Purge,
    [switch]$KeepData
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
    $padded = $Label.PadRight(40)
    Write-Host "  $padded" -NoNewline
    try {
        $null = & $Action 2>&1
        Write-Host "+" -ForegroundColor Green
    } catch {
        Write-Host "x" -ForegroundColor Red
        throw
    }
}

# ──────────────────────────────────────────────
# State
# ──────────────────────────────────────────────
$script:DeployMode       = "bare-metal"
$script:CompliancePort   = 4000
$script:DashboardPort    = 5000
$script:BrandingPort     = 4100
$script:LlmPort          = 4200

# v3.1.0 public URLs (Phase 30/31.1) -- override for production via env vars
$script:DashboardPublicUrl  = $env:DASHBOARD_PUBLIC_URL
$script:CompliancePublicUrl = $env:COMPLIANCE_PUBLIC_URL
$script:BrandingPublicUrl   = $env:BRANDING_PUBLIC_URL
$script:LlmPublicUrl        = $env:LLM_PUBLIC_URL
$script:OAuthKeyMaxAgeDays  = if ($env:OAUTH_KEY_MAX_AGE_DAYS) { $env:OAUTH_KEY_MAX_AGE_DAYS } else { "90" }
$script:OllamaBaseUrl       = $env:OLLAMA_BASE_URL
$script:Pa11yUrlVal      = ""
$script:Pa11yMode        = "builtin"   # builtin | external
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
$script:AdminUsername     = ""
$script:AdminPassword    = ""
$script:SessionSecret    = ""
$script:ClientId         = ""
$script:ClientSecret     = ""
$script:ApiKey           = ""
$script:ConfigFile       = ""

# ──────────────────────────────────────────────
# Apply parameters
# ──────────────────────────────────────────────
if ($Mode)             { $script:DeployMode = $Mode }
if ($Port -gt 0)       { $script:CompliancePort = $Port; $script:DashboardPort = $Port + 1000 }
if ($Pa11yUrl)         { $script:Pa11yUrlVal = $Pa11yUrl; $script:Pa11yMode = "external" }
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
if ($WithNotifySlack)  { $script:NotifySlack = $true }
if ($WithNotifyTeams)  { $script:NotifyTeams = $true }
if ($WithNotifyEmail)  { $script:NotifyEmail = $true }
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
# Uninstall handler — runs before normal install flow.
# Mirrors install.sh --uninstall + install.command launchd cleanup.
# ──────────────────────────────────────────────
function Invoke-LuqenUninstall {
    param([bool]$DoPurge)
    Write-Header "Uninstalling Luqen"

    # Stop + remove NSSM services if present.
    $nssm = Get-Command nssm -ErrorAction SilentlyContinue
    foreach ($svc in @("LuqenCompliance","LuqenBranding","LuqenLlm","LuqenDashboard")) {
        if ($nssm) {
            try { & nssm stop $svc 2>$null | Out-Null } catch {}
            try { & nssm remove $svc confirm 2>$null | Out-Null } catch {}
        }
        try { Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue } catch {}
    }
    Write-Ok "NSSM services stopped/removed (if present)."

    # Unregister Task Scheduler tasks (used when NSSM not installed).
    foreach ($task in @("LuqenCompliance","LuqenBranding","LuqenLlm","LuqenDashboard")) {
        try { Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    }
    Write-Ok "Scheduled tasks unregistered (if present)."

    $installRoot = if ($script:InstallDirVal) { $script:InstallDirVal } else { Join-Path $env:USERPROFILE "luqen" }
    if (Test-Path $installRoot) {
        if ($DoPurge) {
            Write-Info "Purging install directory and all data: $installRoot"
            Remove-Item -Recurse -Force $installRoot
        }
        else {
            $backup = Join-Path $env:USERPROFILE (".luqen-uninstall-" + [DateTimeOffset]::Now.ToUnixTimeSeconds())
            New-Item -ItemType Directory -Path $backup -Force | Out-Null
            foreach ($preserve in @(
                "dashboard.config.json",
                "dashboard.db",
                "packages\compliance\compliance.db"
            )) {
                $src = Join-Path $installRoot $preserve
                if (Test-Path $src) { Copy-Item -Force -Path $src -Destination $backup }
            }
            Remove-Item -Recurse -Force $installRoot
            Write-Ok "Install dir removed. Data preserved at: $backup"
        }
    }
    else {
        Write-Info "No install dir found at $installRoot"
    }

    if ($DoPurge) {
        $luqenHome = Join-Path $env:USERPROFILE ".luqen"
        if (Test-Path $luqenHome) { Remove-Item -Recurse -Force $luqenHome; Write-Ok "Removed $luqenHome" }
    }

    Write-Host ""
    Write-Ok "Luqen uninstalled."
    if (-not $DoPurge) {
        Write-Host ""
        Write-Info "Re-run with -Purge to also drop preserved data."
    }
    exit 0
}

if ($Uninstall) {
    if ($KeepData -and $Purge) {
        Write-Err "-Purge and -KeepData are mutually exclusive."
        exit 1
    }
    Invoke-LuqenUninstall -DoPurge:$Purge.IsPresent
}

# Resolve *_PUBLIC_URL defaults after port fields are finalised.
function Resolve-PublicUrlDefaults {
    if (-not $script:DashboardPublicUrl)  { $script:DashboardPublicUrl  = "http://localhost:$($script:DashboardPort)" }
    if (-not $script:CompliancePublicUrl) { $script:CompliancePublicUrl = "http://localhost:$($script:CompliancePort)" }
    if (-not $script:BrandingPublicUrl)   { $script:BrandingPublicUrl   = "http://localhost:$($script:BrandingPort)" }
    if (-not $script:LlmPublicUrl)        { $script:LlmPublicUrl        = "http://localhost:$($script:LlmPort)" }
}
Resolve-PublicUrlDefaults

# ──────────────────────────────────────────────
# Validation helpers
# ──────────────────────────────────────────────
function Test-UrlReachable {
    param([string]$Url)
    try {
        $null = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        return $true
    } catch { return $false }
}

function Test-PostgresConnection {
    param([string]$ConnStr)
    node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: '$ConnStr', connectionTimeoutMillis: 5000 });
        pool.query('SELECT 1').then(() => { pool.end(); process.exit(0); })
          .catch(() => process.exit(1));
    " 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Test-MongoConnection {
    param([string]$ConnStr)
    node -e "
        const { MongoClient } = require('mongodb');
        const client = new MongoClient('$ConnStr', { serverSelectionTimeoutMS: 5000 });
        client.connect().then(() => client.close()).then(() => process.exit(0))
          .catch(() => process.exit(1));
    " 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Test-SmtpConnection {
    param([string]$SmtpHostArg, [int]$SmtpPortArg)
    node -e "
        const net = require('net');
        const sock = net.createConnection({ host: '$SmtpHostArg', port: $SmtpPortArg, timeout: 5000 });
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
    Write-Host "  $Prompt ${hint}: " -NoNewline
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
    Write-Host "  +======================================+" -ForegroundColor Cyan
    Write-Host "  |     Luqen -- Installation Wizard     |" -ForegroundColor Cyan
    Write-Host "  +======================================+" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Enterprise accessibility testing platform"
    Write-Host ""

    # 1: Deployment Mode
    Write-Header "1. Deployment Mode"

    $choice = Read-Choice "How would you like to deploy Luqen?" @(
        "Bare metal (Node.js + Windows services)"
        "Docker Compose"
    )
    switch ($choice) {
        "2" {
            $script:DeployMode = "docker"
            Write-Ok "Docker Compose deployment selected"
        }
        default {
            $script:DeployMode = "bare-metal"
            Write-Ok "Bare metal deployment selected"
        }
    }

    if ($script:DeployMode -eq "docker") {
        Invoke-WizardDocker
    } else {
        Invoke-WizardBareMetal
    }
}

# ──────────────────────────────────────────────
# Docker wizard
# ──────────────────────────────────────────────
function Invoke-WizardDocker {
    Write-Info "Scanner: built-in (pa11y library in container)"

    Write-Header "2. Ports"
    $script:CompliancePort = [int](Read-Prompt "Compliance port" $script:CompliancePort)
    $script:DashboardPort = $script:CompliancePort + 1000
    $script:DashboardPort = [int](Read-Prompt "Dashboard port" $script:DashboardPort)

    Write-Header "3. Admin Account"
    Write-Host "  Create an admin user, or log in with the API key later."
    Write-Host ""

    if (Read-YesNo "Create an admin user now?" $true) {
        $script:AdminUsername = Read-Prompt "Admin username" "admin"
        while ($true) {
            $script:AdminPassword = Read-Secret "Admin password (min 8 chars)"
            if ($script:AdminPassword.Length -ge 8) { break }
            Write-Warn "Password must be at least 8 characters."
        }
        Write-Ok "Admin user will be created after startup"
    }

    # Summary
    Write-Host ""
    Write-Host "  +------------------------------------------+" -ForegroundColor White
    Write-Host "  |          Installation Summary             |" -ForegroundColor White
    Write-Host "  +------------------------------------------+" -ForegroundColor White
    Write-Host ""
    $fmt = "  {0,-22} {1}"
    Write-Host ($fmt -f "Mode:", "Docker Compose")
    Write-Host ($fmt -f "Compliance port:", $script:CompliancePort)
    Write-Host ($fmt -f "Dashboard port:", $script:DashboardPort)
    Write-Host ($fmt -f "Scanner:", "built-in (pa11y library)")
    Write-Host ($fmt -f "Database:", "SQLite (container volume)")
    if ($script:AdminUsername) { Write-Host ($fmt -f "Admin user:", $script:AdminUsername) }

    Write-Host ""
    if (-not (Read-YesNo "Proceed with installation?" $true)) {
        Write-Info "Installation cancelled."
        exit 0
    }
}

# ──────────────────────────────────────────────
# Bare-metal wizard
# ──────────────────────────────────────────────
function Invoke-WizardBareMetal {

    # 2: Scanner Engine
    Write-Header "2. Scanner Engine"
    $choice = Read-Choice "Scanner engine:" @(
        "Built-in (pa11y library -- recommended, no external deps)"
        "External pa11y webservice (enter URL, validated)"
    )
    switch ($choice) {
        "2" {
            $script:Pa11yMode = "external"
            $ok = $false
            for ($attempt = 1; $attempt -le 3; $attempt++) {
                $script:Pa11yUrlVal = Read-Prompt "pa11y webservice URL" "http://localhost:3000"
                Write-Host "  Validating pa11y endpoint... " -NoNewline -ForegroundColor DarkGray
                if (Test-UrlReachable "$($script:Pa11yUrlVal)/api/tasks") {
                    Write-Ok "reachable"
                    $ok = $true
                    break
                }
                Write-Warn "Could not reach $($script:Pa11yUrlVal)/api/tasks (attempt $attempt/3)"
            }
            if (-not $ok) {
                Write-Err "pa11y URL validation failed. You can configure it later."
                $script:Pa11yUrlVal = ""
                $script:Pa11yMode = "builtin"
            }
        }
        default {
            $script:Pa11yMode = "builtin"
            $script:Pa11yUrlVal = ""
            Write-Ok "Built-in scanner (pa11y library, no external service needed)"
        }
    }

    # 3: Database
    Write-Header "3. Database"
    Write-Host "  The dashboard needs a database for scan results, users, and settings."
    Write-Host ""

    $choice = Read-Choice "Database:" @(
        "SQLite (default, no setup needed)"
        "PostgreSQL (enter connection string, validated)"
        "MongoDB (enter connection URI, validated)"
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
            $script:DbConnectionString = Read-Prompt "MongoDB connection URI" "mongodb://localhost:27017/luqen"
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

    # 4: Authentication
    Write-Header "4. Authentication"
    Write-Host "  Choose how users will sign in."
    Write-Host ""

    $choice = Read-Choice "Identity provider:" @(
        "API key only (solo/team mode -- default)"
        "Azure Entra ID SSO"
        "Okta SSO"
        "Google Workspace SSO"
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

    # 5: Notifications
    Write-Header "5. Notifications"
    Write-Host "  Get notified when scans complete (select all that apply)."
    Write-Host ""

    if (Read-YesNo "Slack notifications?" $false) {
        $script:NotifySlack = $true
        $script:SlackWebhookUrlVal = Read-Prompt "Slack webhook URL" ""
    }
    if (Read-YesNo "Microsoft Teams notifications?" $false) {
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

    # 6: Ports
    Write-Header "6. Ports"
    $script:CompliancePort = [int](Read-Prompt "Compliance port" $script:CompliancePort)
    $script:DashboardPort = $script:CompliancePort + 1000
    $script:DashboardPort = [int](Read-Prompt "Dashboard port" $script:DashboardPort)
    $script:InstallDirVal = Read-Prompt "Installation directory" $script:InstallDirVal

    # 7: Admin user
    Write-Header "7. Admin Account"
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

    # 8: Summary
    Write-Host ""
    Write-Host "  +------------------------------------------+" -ForegroundColor White
    Write-Host "  |        8. Installation Summary            |" -ForegroundColor White
    Write-Host "  +------------------------------------------+" -ForegroundColor White
    Write-Host ""

    $fmt = "  {0,-22} {1}"
    Write-Host ($fmt -f "Mode:", "Bare metal")
    Write-Host ($fmt -f "Install directory:", $script:InstallDirVal)
    Write-Host ($fmt -f "Compliance port:", $script:CompliancePort)
    Write-Host ($fmt -f "Dashboard port:", $script:DashboardPort)
    Write-Host ($fmt -f "Scanner:", $(if ($script:Pa11yMode -eq "external") { "external ($($script:Pa11yUrlVal))" } else { "built-in (pa11y library)" }))
    Write-Host ($fmt -f "Database:", $script:DbAdapter)
    Write-Host ($fmt -f "Authentication:", $script:AuthProvider)

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

# ══════════════════════════════════════════════
#  BARE-METAL INSTALLATION STEPS
# ══════════════════════════════════════════════

$script:TotalStepsBM = 10

function Test-Prerequisites {
    Write-Step 1 $script:TotalStepsBM "Checking prerequisites"

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

function Invoke-CloneOrPull {
    Write-Step 2 $script:TotalStepsBM "Fetching source code"

    $gitDir = Join-Path $script:InstallDirVal ".git"
    if (Test-Path $gitDir) {
        Invoke-Quiet "Pulling latest changes" { git -C $script:InstallDirVal pull --ff-only 2>&1 }
    } else {
        Invoke-Quiet "Cloning repository" { git clone $script:RepoUrl $script:InstallDirVal 2>&1 }
    }
}

function Install-AndBuild {
    Write-Step 3 $script:TotalStepsBM "Installing dependencies and building"

    Push-Location $script:InstallDirVal
    try {
        Invoke-Quiet "Installing npm dependencies" { npm install --prefer-offline 2>&1 }
        Invoke-Quiet "Building packages" { npm run build --workspaces 2>&1 }
    } finally { Pop-Location }
}

function New-Secrets {
    Write-Step 4 $script:TotalStepsBM "Generating secrets"

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

function Invoke-Seed {
    Write-Step 5 $script:TotalStepsBM "Seeding compliance data"

    if ($script:Seed) {
        Push-Location (Join-Path $script:InstallDirVal "packages\compliance")
        Invoke-Quiet "Seeding jurisdictions and regulations" { node dist/cli.js seed 2>&1 }
        Pop-Location
    } else {
        Write-Info "Seeding skipped (-NoSeed)"
    }
}

function New-OAuthClient {
    Write-Step 6 $script:TotalStepsBM "Creating OAuth client"

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

function Write-Config {
    Write-Step 7 $script:TotalStepsBM "Writing configuration"

    $script:InstallDirVal = (Resolve-Path $script:InstallDirVal).Path
    $script:ConfigFile = Join-Path $script:InstallDirVal "dashboard.config.json"

    $config = @{
        port                   = $script:DashboardPort
        complianceUrl          = "http://localhost:$($script:CompliancePort)"
        sessionSecret          = $script:SessionSecret
        complianceClientId     = $script:ClientId
        complianceClientSecret = $script:ClientSecret
        dbPath                 = (Join-Path $script:InstallDirVal "dashboard.db")
        reportsDir             = (Join-Path $script:InstallDirVal "reports")
        pluginsDir             = (Join-Path $script:InstallDirVal "plugins")
    }

    if ($script:Pa11yMode -eq "external" -and $script:Pa11yUrlVal) {
        $config["webserviceUrl"] = $script:Pa11yUrlVal
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
    Write-Ok "dashboard.config.json written (all absolute paths)"
}

function New-WindowsServices {
    Write-Step 8 $script:TotalStepsBM "Creating Windows services"

    Resolve-PublicUrlDefaults

    $nodePath = (Get-Command node).Source
    $nssmPath = Get-Command nssm -ErrorAction SilentlyContinue

    # MCP runs embedded in the dashboard (Fastify plugin). DO NOT register a
    # separate LuqenMcp service. Daemons: compliance, branding, llm, dashboard.

    $complianceEnv = @(
        "NODE_ENV=production",
        "COMPLIANCE_PORT=$($script:CompliancePort)",
        "COMPLIANCE_PUBLIC_URL=$($script:CompliancePublicUrl)",
        "COMPLIANCE_LLM_URL=$($script:LlmPublicUrl)"
    )
    $brandingEnv = @(
        "NODE_ENV=production",
        "BRANDING_PORT=$($script:BrandingPort)",
        "BRANDING_PUBLIC_URL=$($script:BrandingPublicUrl)"
    )
    $llmEnv = @(
        "NODE_ENV=production",
        "LLM_PORT=$($script:LlmPort)",
        "LLM_PUBLIC_URL=$($script:LlmPublicUrl)"
    )
    if ($script:OllamaBaseUrl) { $llmEnv += "OLLAMA_BASE_URL=$($script:OllamaBaseUrl)" }

    $dashEnv = @(
        "NODE_ENV=production",
        "DASHBOARD_SESSION_SECRET=$($script:SessionSecret)",
        "DASHBOARD_PUBLIC_URL=$($script:DashboardPublicUrl)",
        "DASHBOARD_JWKS_URI=$($script:DashboardPublicUrl)/oauth/.well-known/jwks.json",
        "DASHBOARD_JWKS_URL=$($script:DashboardPublicUrl)/oauth/.well-known/jwks.json",
        "OAUTH_KEY_MAX_AGE_DAYS=$($script:OAuthKeyMaxAgeDays)",
        "DASHBOARD_COMPLIANCE_URL=$($script:CompliancePublicUrl)",
        "DASHBOARD_COMPLIANCE_CLIENT_ID=$($script:ClientId)",
        "DASHBOARD_COMPLIANCE_CLIENT_SECRET=$($script:ClientSecret)",
        "COMPLIANCE_PUBLIC_URL=$($script:CompliancePublicUrl)",
        "BRANDING_PUBLIC_URL=$($script:BrandingPublicUrl)",
        "LLM_PUBLIC_URL=$($script:LlmPublicUrl)"
    )
    if ($script:Pa11yMode -eq "external" -and $script:Pa11yUrlVal) {
        $dashEnv += "DASHBOARD_WEBSERVICE_URL=$($script:Pa11yUrlVal)"
    }

    if ($nssmPath) {
        Write-Info "Using NSSM to create services..."

        # Compliance
        & nssm install "LuqenCompliance" "$nodePath" "$($script:InstallDirVal)\packages\compliance\dist\cli.js serve --port $($script:CompliancePort)" 2>$null | Out-Null
        & nssm set "LuqenCompliance" AppDirectory (Join-Path $script:InstallDirVal "packages\compliance") 2>$null | Out-Null
        & nssm set "LuqenCompliance" Description "Luqen Compliance Service" 2>$null | Out-Null
        & nssm set "LuqenCompliance" Start SERVICE_AUTO_START 2>$null | Out-Null
        & nssm set "LuqenCompliance" AppEnvironmentExtra $complianceEnv 2>$null | Out-Null

        # Branding
        & nssm install "LuqenBranding" "$nodePath" "$($script:InstallDirVal)\packages\branding\dist\cli.js serve --port $($script:BrandingPort)" 2>$null | Out-Null
        & nssm set "LuqenBranding" AppDirectory (Join-Path $script:InstallDirVal "packages\branding") 2>$null | Out-Null
        & nssm set "LuqenBranding" Description "Luqen Branding Service" 2>$null | Out-Null
        & nssm set "LuqenBranding" Start SERVICE_AUTO_START 2>$null | Out-Null
        & nssm set "LuqenBranding" AppEnvironmentExtra $brandingEnv 2>$null | Out-Null

        # LLM
        & nssm install "LuqenLlm" "$nodePath" "$($script:InstallDirVal)\packages\llm\dist\cli.js serve --port $($script:LlmPort)" 2>$null | Out-Null
        & nssm set "LuqenLlm" AppDirectory (Join-Path $script:InstallDirVal "packages\llm") 2>$null | Out-Null
        & nssm set "LuqenLlm" Description "Luqen LLM Service" 2>$null | Out-Null
        & nssm set "LuqenLlm" Start SERVICE_AUTO_START 2>$null | Out-Null
        & nssm set "LuqenLlm" AppEnvironmentExtra $llmEnv 2>$null | Out-Null

        # Dashboard
        $dashArgs = "$($script:InstallDirVal)\packages\dashboard\dist\cli.js serve --config $($script:ConfigFile)"
        & nssm install "LuqenDashboard" "$nodePath" $dashArgs 2>$null | Out-Null
        & nssm set "LuqenDashboard" AppDirectory $script:InstallDirVal 2>$null | Out-Null
        & nssm set "LuqenDashboard" Description "Luqen Dashboard" 2>$null | Out-Null
        & nssm set "LuqenDashboard" Start SERVICE_AUTO_START 2>$null | Out-Null
        & nssm set "LuqenDashboard" DependOnService "LuqenCompliance" "LuqenBranding" "LuqenLlm" 2>$null | Out-Null
        & nssm set "LuqenDashboard" AppEnvironmentExtra $dashEnv 2>$null | Out-Null

        Write-Ok "NSSM services created (LuqenCompliance, LuqenBranding, LuqenLlm, LuqenDashboard)"
    } else {
        Write-Info "NSSM not found -- using Task Scheduler..."

        $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        $taskTrigger = New-ScheduledTaskTrigger -AtStartup

        # Compliance
        $compArgs = "$($script:InstallDirVal)\packages\compliance\dist\cli.js serve --port $($script:CompliancePort)"
        $compAction = New-ScheduledTaskAction -Execute $nodePath -Argument $compArgs `
            -WorkingDirectory (Join-Path $script:InstallDirVal "packages\compliance")
        Register-ScheduledTask -TaskName "LuqenCompliance" -Action $compAction -Trigger $taskTrigger `
            -Settings $taskSettings -Description "Luqen Compliance Service" -User "SYSTEM" -Force 2>$null | Out-Null

        # Branding
        $brandArgs = "$($script:InstallDirVal)\packages\branding\dist\cli.js serve --port $($script:BrandingPort)"
        $brandAction = New-ScheduledTaskAction -Execute $nodePath -Argument $brandArgs `
            -WorkingDirectory (Join-Path $script:InstallDirVal "packages\branding")
        Register-ScheduledTask -TaskName "LuqenBranding" -Action $brandAction -Trigger $taskTrigger `
            -Settings $taskSettings -Description "Luqen Branding Service" -User "SYSTEM" -Force 2>$null | Out-Null

        # LLM
        $llmArgs = "$($script:InstallDirVal)\packages\llm\dist\cli.js serve --port $($script:LlmPort)"
        $llmAction = New-ScheduledTaskAction -Execute $nodePath -Argument $llmArgs `
            -WorkingDirectory (Join-Path $script:InstallDirVal "packages\llm")
        Register-ScheduledTask -TaskName "LuqenLlm" -Action $llmAction -Trigger $taskTrigger `
            -Settings $taskSettings -Description "Luqen LLM Service" -User "SYSTEM" -Force 2>$null | Out-Null

        # Dashboard
        $dashArgs = "$($script:InstallDirVal)\packages\dashboard\dist\cli.js serve --config $($script:ConfigFile)"
        $dashAction = New-ScheduledTaskAction -Execute $nodePath -Argument $dashArgs `
            -WorkingDirectory $script:InstallDirVal
        Register-ScheduledTask -TaskName "LuqenDashboard" -Action $dashAction -Trigger $taskTrigger `
            -Settings $taskSettings -Description "Luqen Dashboard" -User "SYSTEM" -Force 2>$null | Out-Null

        Write-Warn "Task Scheduler tasks do not carry env vars set above."
        Write-Warn "For env-aware service hosting on Windows, install NSSM and re-run."
        Write-Ok "Scheduled tasks created (LuqenCompliance, LuqenBranding, LuqenLlm, LuqenDashboard)"
    }
}

function Show-V3WhatsNew {
    Write-Host ""
    Write-Host "  What's new since v2.12.0" -ForegroundColor Cyan
    Write-Host "  ========================" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  New admin pages:"
    Write-Host "    /admin/audit         Agent audit log viewer (filter + CSV export) -- audit.view"
    Write-Host "    /admin/oauth-keys    OAuth signing-key inventory + manual rotate -- admin.system"
    Write-Host ""
    Write-Host "  New end-user surface:"
    Write-Host "    /agent               Agent companion side panel (text + speech)"
    Write-Host "    /agent/share/<id>    Read-only conversation share-link permalinks"
    Write-Host "    /api/mcp             Streamable HTTP MCP endpoint"
    Write-Host "    /oauth/.well-known/* Authorization-server / JWKS / protected-resource discovery"
    Write-Host ""
    Write-Host "  New RBAC permission:"
    Write-Host "    mcp.use              Gate for calling MCP tools (back-filled by migration 054)"
    Write-Host ""
    Write-Host "  For production set DASHBOARD_PUBLIC_URL / DASHBOARD_JWKS_URI before re-running"
    Write-Host "  this installer; the dashboard service will pick the new values on next start."
    Write-Host ""
    Write-Host "  More detail: docs/deployment/installer-changelog.md"
    Write-Host ""
}

# ──────────────────────────────────────────────
# Plugin helpers
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
    Write-Info "Installing plugins..."

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
# Step 9: Start services + post-install
# ──────────────────────────────────────────────
function Start-LuqenServices {
    Write-Step 9 $script:TotalStepsBM "Starting services"

    $nssmPath = Get-Command nssm -ErrorAction SilentlyContinue
    $compLogFile = Join-Path $env:TEMP "luqen-comp-install.log"
    $dashLogFile = Join-Path $env:TEMP "luqen-dash-install.log"

    $env:COMPLIANCE_PORT = $script:CompliancePort
    $compProcess = Start-Process -FilePath (Get-Command node).Source `
        -ArgumentList "$($script:InstallDirVal)\packages\compliance\dist\cli.js", "serve", "--port", $script:CompliancePort `
        -WorkingDirectory (Join-Path $script:InstallDirVal "packages\compliance") `
        -RedirectStandardOutput $compLogFile `
        -RedirectStandardError (Join-Path $env:TEMP "luqen-comp-err.log") `
        -PassThru -WindowStyle Hidden

    Start-Sleep -Seconds 3

    Write-Info "Waiting for compliance service..."
    $attempts = 0
    while ($true) {
        try {
            $null = Invoke-RestMethod -Uri "http://localhost:$($script:CompliancePort)/api/v1/health" -TimeoutSec 2 -ErrorAction Stop
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
    $env:DASHBOARD_COMPLIANCE_CLIENT_ID = $script:ClientId
    $env:DASHBOARD_COMPLIANCE_CLIENT_SECRET = $script:ClientSecret
    if ($script:Pa11yMode -eq "external" -and $script:Pa11yUrlVal) {
        $env:DASHBOARD_WEBSERVICE_URL = $script:Pa11yUrlVal
    }

    $dashProcess = Start-Process -FilePath (Get-Command node).Source `
        -ArgumentList "$($script:InstallDirVal)\packages\dashboard\dist\cli.js", "serve", "--config", $script:ConfigFile `
        -WorkingDirectory $script:InstallDirVal `
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

    # Stop temp processes
    try { Stop-Process -Id $compProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
    try { Stop-Process -Id $dashProcess.Id -Force -ErrorAction SilentlyContinue } catch {}

    # Start services properly
    if ($nssmPath) {
        & nssm start "LuqenCompliance" 2>$null | Out-Null
        & nssm start "LuqenDashboard" 2>$null | Out-Null
    } else {
        Start-ScheduledTask -TaskName "LuqenCompliance" -ErrorAction SilentlyContinue
        Start-ScheduledTask -TaskName "LuqenDashboard" -ErrorAction SilentlyContinue
    }

    # Clean up env vars
    @("COMPLIANCE_PORT","DASHBOARD_SESSION_SECRET","DASHBOARD_COMPLIANCE_URL",
      "DASHBOARD_WEBSERVICE_URL","DASHBOARD_COMPLIANCE_CLIENT_ID",
      "DASHBOARD_COMPLIANCE_CLIENT_SECRET") | ForEach-Object {
        Remove-Item "Env:\$_" -ErrorAction SilentlyContinue
    }
}

function Show-SummaryBareMetal {
    Write-Step 10 $script:TotalStepsBM "Installation complete"

    Write-Host ""
    Write-Host "  +==========================================+" -ForegroundColor Green
    Write-Host "  |      Luqen installed successfully!       |" -ForegroundColor Green
    Write-Host "  +==========================================+" -ForegroundColor Green
    Write-Host ""
    Write-Host "  URLs:" -ForegroundColor White
    Write-Host "    Dashboard:   " -NoNewline; Write-Host "http://localhost:$($script:DashboardPort)" -ForegroundColor Cyan
    Write-Host "    Compliance:  " -NoNewline; Write-Host "http://localhost:$($script:CompliancePort)" -ForegroundColor Cyan
    if ($script:Pa11yMode -eq "external" -and $script:Pa11yUrlVal) {
        Write-Host "    pa11y:       $($script:Pa11yUrlVal)"
    } else {
        Write-Host "    Scanner:     built-in (pa11y library)"
    }
    Write-Host ""

    if ($script:AdminUsername) {
        Write-Host "  Login:" -ForegroundColor White
        Write-Host "    Username:  $($script:AdminUsername)"
        Write-Host "    Password:  (the password you entered)"
        Write-Host ""
    }

    if ($script:ApiKey) {
        Write-Host "  API Key: (save this -- also works for login)" -ForegroundColor White
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

# ══════════════════════════════════════════════
#  DOCKER COMPOSE INSTALLATION
# ══════════════════════════════════════════════

$script:TotalStepsDocker = 5

function Invoke-DockerInstall {
    # Step 1: Prerequisites
    Write-Step 1 $script:TotalStepsDocker "Checking Docker prerequisites"

    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Err "Docker is not installed. Install Docker Desktop from https://docs.docker.com/desktop/install/windows/"
        exit 1
    }
    Write-Ok "Docker found"

    # Step 2: Clone / pull
    Write-Step 2 $script:TotalStepsDocker "Fetching source code"

    $gitDir = Join-Path $script:InstallDirVal ".git"
    if (Test-Path $gitDir) {
        Invoke-Quiet "Pulling latest changes" { git -C $script:InstallDirVal pull --ff-only 2>&1 }
    } else {
        $gitCmd = Get-Command git -ErrorAction SilentlyContinue
        if (-not $gitCmd) {
            Write-Err "git is required to clone the repository."
            exit 1
        }
        Invoke-Quiet "Cloning repository" { git clone $script:RepoUrl $script:InstallDirVal 2>&1 }
    }

    # Step 3: Generate .env
    Write-Step 3 $script:TotalStepsDocker "Generating configuration"

    $script:InstallDirVal = (Resolve-Path $script:InstallDirVal).Path
    $script:SessionSecret = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" 2>$null

    $envFile = Join-Path $script:InstallDirVal ".env"
    $envContent = @"
# Luqen Docker Compose configuration
# Generated by install.ps1 on $(Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
# Last reviewed for v3.1.0 (Phase 40 / DOC-03) -- head migration 061
COMPLIANCE_PORT=$($script:CompliancePort)
DASHBOARD_PORT=$($script:DashboardPort)
DASHBOARD_SESSION_SECRET=$($script:SessionSecret)
LUQEN_WEBSERVICE_URL=

# Public URLs (Phase 30/31.1) -- override for production
DASHBOARD_PUBLIC_URL=$($script:DashboardPublicUrl)
COMPLIANCE_PUBLIC_URL=$($script:CompliancePublicUrl)
BRANDING_PUBLIC_URL=$($script:BrandingPublicUrl)
LLM_PUBLIC_URL=$($script:LlmPublicUrl)

# OAuth signing-key rotation (Phase 31.1)
OAUTH_KEY_MAX_AGE_DAYS=$($script:OAuthKeyMaxAgeDays)

# JWKS discovery (Phase 31.1) -- prefer JWKS_URI over inline JWT_PUBLIC_KEY
DASHBOARD_JWKS_URI=$($script:DashboardPublicUrl)/oauth/.well-known/jwks.json
DASHBOARD_JWKS_URL=$($script:DashboardPublicUrl)/oauth/.well-known/jwks.json
# DASHBOARD_JWT_PUBLIC_KEY=

# Optional: Ollama provider for the LLM service
# OLLAMA_BASE_URL=http://localhost:11434
"@
    Set-Content -Path $envFile -Value $envContent -Encoding UTF8
    Write-Ok ".env written at $envFile"

    # Step 4: Build and start
    Write-Step 4 $script:TotalStepsDocker "Building and starting containers"

    Push-Location $script:InstallDirVal
    try {
        Invoke-Quiet "Building images" { docker compose build 2>&1 }
        Invoke-Quiet "Starting containers" { docker compose up -d 2>&1 }
    } finally { Pop-Location }

    Write-Info "Waiting for services to become healthy..."
    $attempts = 0
    while ($true) {
        try {
            $null = Invoke-RestMethod -Uri "http://localhost:$($script:DashboardPort)/health" -TimeoutSec 2 -ErrorAction Stop
            break
        } catch {
            $attempts++
            if ($attempts -ge 30) { Write-Err "Services did not start. Check: docker compose logs"; break }
            Start-Sleep -Seconds 2
        }
    }
    Write-Ok "All containers running and healthy"

    # Grab API key
    $dockerLogs = docker compose logs dashboard 2>$null | Out-String
    if ($dockerLogs -match "API Key: ([a-f0-9]{64})") {
        $script:ApiKey = $Matches[1]
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

    # Step 5: Summary
    Write-Step 5 $script:TotalStepsDocker "Installation complete"

    Write-Host ""
    Write-Host "  +==========================================+" -ForegroundColor Green
    Write-Host "  |      Luqen installed successfully!       |" -ForegroundColor Green
    Write-Host "  +==========================================+" -ForegroundColor Green
    Write-Host ""
    Write-Host "  URLs:" -ForegroundColor White
    Write-Host "    Dashboard:   " -NoNewline; Write-Host "http://localhost:$($script:DashboardPort)" -ForegroundColor Cyan
    Write-Host "    Compliance:  " -NoNewline; Write-Host "http://localhost:$($script:CompliancePort)" -ForegroundColor Cyan
    Write-Host "    Scanner:     built-in (pa11y library)"
    Write-Host ""

    if ($script:AdminUsername) {
        Write-Host "  Login:" -ForegroundColor White
        Write-Host "    Username:  $($script:AdminUsername)"
        Write-Host "    Password:  (the password you entered)"
        Write-Host ""
    }

    if ($script:ApiKey) {
        Write-Host "  API Key: (save this -- also works for login)" -ForegroundColor White
        Write-Host "    $($script:ApiKey)" -ForegroundColor Yellow
        Write-Host ""
    }

    Write-Host "  Docker management:" -ForegroundColor White
    Write-Host "    cd $($script:InstallDirVal)"
    Write-Host "    docker compose ps              # status"
    Write-Host "    docker compose logs -f         # follow logs"
    Write-Host "    docker compose down            # stop"
    Write-Host "    docker compose up -d           # start"
    Write-Host ""
    Write-Host "  Data volumes:" -ForegroundColor White
    Write-Host "    compliance-data, compliance-keys, dashboard-data, dashboard-reports"
    Write-Host ""
}

# ══════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════

if ($script:Interactive -and -not $NonInteractive -and [Environment]::UserInteractive) {
    Invoke-Wizard
}

# Route to the correct installation path
Resolve-PublicUrlDefaults

if ($script:DeployMode -eq "docker") {
    Invoke-DockerInstall
    Show-V3WhatsNew
} else {
    Test-Prerequisites         # Step 1
    Invoke-CloneOrPull         # Step 2
    Install-AndBuild           # Step 3
    New-Secrets                # Step 4
    Invoke-Seed                # Step 5
    New-OAuthClient            # Step 6
    Write-Config               # Step 7
    New-WindowsServices        # Step 8
    Start-LuqenServices       # Step 9
    Show-SummaryBareMetal      # Step 10
    Show-V3WhatsNew            # Post: print v3.x changes summary
}
