#Requires -Version 5.1
<#
.SYNOPSIS
    Luqen Installer for Windows (PowerShell)

.DESCRIPTION
    Interactive wizard to install Luqen, the enterprise accessibility testing platform.
    Supports Docker Compose or local Node.js deployment.

.PARAMETER Docker
    Use Docker Compose deployment mode.

.PARAMETER Local
    Use local Node.js deployment mode.

.PARAMETER Port
    Override the compliance service port (default: 4000). Dashboard = Port + 1000.

.PARAMETER Pa11yUrl
    Existing pa11y webservice URL.

.PARAMETER Pa11yDocker
    Create a new pa11y webservice via Docker.

.PARAMETER NoSeed
    Skip baseline data seeding.

.PARAMETER NonInteractive
    Skip all prompts (use defaults + flags).

.PARAMETER InstallDir
    Installation directory (default: $HOME\luqen).

.PARAMETER WithMonitor
    Include the regulatory monitor agent.

.PARAMETER WithAuthEntra
    Install Azure Entra ID SSO plugin.

.PARAMETER WithNotifySlack
    Install Slack notification plugin.

.PARAMETER WithNotifyTeams
    Install Teams notification plugin.

.PARAMETER WithNotifyEmail
    Install Email notification plugin.

.PARAMETER WithStorageS3
    Install AWS S3 storage plugin.

.PARAMETER WithStorageAzure
    Install Azure Blob storage plugin.

.PARAMETER WithAllPlugins
    Install all plugins.

.EXAMPLE
    irm https://raw.githubusercontent.com/trunten82/luqen/master/install.ps1 | iex

.EXAMPLE
    .\install.ps1 -Docker -Pa11yUrl http://pa11y:3000 -NonInteractive
#>

[CmdletBinding()]
param(
    [switch]$Docker,
    [switch]$Local,
    [int]$Port = 0,
    [string]$Pa11yUrl = "",
    [switch]$Pa11yDocker,
    [switch]$NoSeed,
    [switch]$NonInteractive,
    [string]$InstallDir = "",
    [switch]$WithMonitor,
    [switch]$WithAuthEntra,
    [switch]$WithNotifySlack,
    [switch]$WithNotifyTeams,
    [switch]$WithNotifyEmail,
    [switch]$WithStorageS3,
    [switch]$WithStorageAzure,
    [switch]$WithAllPlugins
)

$ErrorActionPreference = "Stop"

# ──────────────────────────────────────────────
# Color helpers
# ──────────────────────────────────────────────
function Write-Info    { param([string]$Msg) Write-Host "  * " -ForegroundColor Cyan -NoNewline; Write-Host $Msg }
function Write-Ok      { param([string]$Msg) Write-Host "  + " -ForegroundColor Green -NoNewline; Write-Host $Msg -ForegroundColor Green }
function Write-Warn    { param([string]$Msg) Write-Host "  ! " -ForegroundColor Yellow -NoNewline; Write-Host $Msg -ForegroundColor Yellow }
function Write-Err     { param([string]$Msg) Write-Host "  X " -ForegroundColor Red -NoNewline; Write-Host $Msg -ForegroundColor Red }
function Write-Header  { param([string]$Msg) Write-Host ""; Write-Host "  $Msg" -ForegroundColor Cyan -NoNewline; Write-Host "" ; Write-Host "" }

# ──────────────────────────────────────────────
# Defaults
# ──────────────────────────────────────────────
$script:DockerMode       = ""
$script:CompliancePort   = 4000
$script:DashboardPort    = 5000
$script:Pa11yUrlVal      = ""
$script:Pa11yDockerVal   = $false
$script:Seed             = $true
$script:Interactive      = $true
$script:RepoUrl          = "https://github.com/trunten82/luqen.git"
$script:InstallDirVal    = Join-Path $HOME "luqen"

# Modules
$script:ModCompliance = $true
$script:ModDashboard  = $true
$script:ModMonitor    = $false

# Plugins
$script:PluginAuthEntra    = $false
$script:PluginNotifySlack  = $false
$script:PluginNotifyTeams  = $false
$script:PluginNotifyEmail  = $false
$script:PluginStorageS3    = $false
$script:PluginStorageAzure = $false

# Admin user
$script:AdminUsername = ""
$script:AdminPassword = ""

# Deploy template
$script:DeployTemplate = "standard"

# ──────────────────────────────────────────────
# Apply parameters
# ──────────────────────────────────────────────
if ($Docker)          { $script:DockerMode = "docker" }
if ($Local)           { $script:DockerMode = "local" }
if ($Port -gt 0)      { $script:CompliancePort = $Port; $script:DashboardPort = $Port + 1000 }
if ($Pa11yUrl)         { $script:Pa11yUrlVal = $Pa11yUrl }
if ($Pa11yDocker)      { $script:Pa11yDockerVal = $true }
if ($NoSeed)           { $script:Seed = $false }
if ($NonInteractive)   { $script:Interactive = $false }
if ($InstallDir)       { $script:InstallDirVal = $InstallDir }
if ($WithMonitor)      { $script:ModMonitor = $true }
if ($WithAuthEntra)    { $script:PluginAuthEntra = $true }
if ($WithNotifySlack)  { $script:PluginNotifySlack = $true }
if ($WithNotifyTeams)  { $script:PluginNotifyTeams = $true }
if ($WithNotifyEmail)  { $script:PluginNotifyEmail = $true }
if ($WithStorageS3)    { $script:PluginStorageS3 = $true }
if ($WithStorageAzure) { $script:PluginStorageAzure = $true }
if ($WithAllPlugins) {
    $script:PluginAuthEntra    = $true
    $script:PluginNotifySlack  = $true
    $script:PluginNotifyTeams  = $true
    $script:PluginNotifyEmail  = $true
    $script:PluginStorageS3    = $true
    $script:PluginStorageAzure = $true
}

# ──────────────────────────────────────────────
# Interactive prompt helpers
# ──────────────────────────────────────────────
function Read-Prompt {
    param([string]$Prompt, [string]$Default)
    $display = "$Prompt [$Default]"
    Write-Host "  $display" -NoNewline
    Write-Host ": " -NoNewline
    $input = Read-Host
    if ([string]::IsNullOrWhiteSpace($input)) { return $Default }
    return $input
}

function Read-YesNo {
    param([string]$Prompt, [bool]$Default = $true)
    $hint = if ($Default) { "[Y/n]" } else { "[y/N]" }
    Write-Host "  $Prompt $hint" -NoNewline
    Write-Host ": " -NoNewline
    $input = Read-Host
    if ([string]::IsNullOrWhiteSpace($input)) { return $Default }
    return $input -match "^[yY]"
}

function Read-Choice {
    param([string]$Prompt, [string[]]$Options)
    Write-Host ""
    Write-Host "  $Prompt" -ForegroundColor White
    for ($i = 0; $i -lt $Options.Count; $i++) {
        Write-Host "    " -NoNewline
        Write-Host "$($i + 1)" -ForegroundColor Cyan -NoNewline
        Write-Host ") $($Options[$i])"
    }
    Write-Host ""
    Write-Host "    Choice" -NoNewline
    Write-Host ": " -NoNewline
    $choice = Read-Host
    return $choice
}

# ──────────────────────────────────────────────
# INTERACTIVE WIZARD
# ──────────────────────────────────────────────
function Invoke-Wizard {
    Write-Header "Luqen Installation Wizard"
    Write-Host "  Welcome! This wizard will guide you through setting up Luqen,"
    Write-Host "  the enterprise accessibility testing platform."
    Write-Host ""

    # Step 1: Deployment mode
    $choice = Read-Choice "How would you like to deploy Luqen?" @(
        "Docker Compose (recommended - all services in containers)"
        "Local Node.js (requires Node.js 20+)"
    )
    switch ($choice) {
        "1" { $script:DockerMode = "docker" }
        "2" { $script:DockerMode = "local" }
        default { $script:DockerMode = "docker" }
    }
    Write-Ok "Deployment: $($script:DockerMode)"

    # Step 1b: Docker deployment type
    $script:DeployTemplate = "standard"
    if ($script:DockerMode -eq "docker") {
        Write-Host ""
        $choice = Read-Choice "Docker deployment type:" @(
            "Minimal - Compliance + Dashboard only (bring your own pa11y)"
            "Standard - Includes pa11y + MongoDB + Redis (recommended)"
            "Full - Standard + Monitor agent + PDF generation"
        )
        switch ($choice) {
            "1" { $script:DeployTemplate = "minimal" }
            "2" {
                $script:DeployTemplate = "standard"
                $script:Pa11yDockerVal = $true
                $script:Pa11yUrlVal = "http://pa11y:3000"
            }
            "3" {
                $script:DeployTemplate = "full"
                $script:Pa11yDockerVal = $true
                $script:Pa11yUrlVal = "http://pa11y:3000"
                $script:ModMonitor = $true
            }
            default {
                $script:DeployTemplate = "standard"
                $script:Pa11yDockerVal = $true
                $script:Pa11yUrlVal = "http://pa11y:3000"
            }
        }
        Write-Ok "Template: $($script:DeployTemplate)"
    }

    # Step 2: pa11y webservice
    if ($script:Pa11yDockerVal -and $script:DockerMode -eq "docker") {
        Write-Info "pa11y webservice included in Docker template."
    } else {
        Write-Host ""
        Write-Header "pa11y Webservice"
        Write-Host "  Luqen uses pa11y webservice as its accessibility scan engine."
        Write-Host "  You can connect to an existing instance or create a new one."
        Write-Host ""

        $choice = Read-Choice "pa11y webservice setup:" @(
            "I have an existing pa11y webservice"
            "Create a new pa11y webservice via Docker"
            "Skip - I'll configure it later"
        )
        switch ($choice) {
            "1" {
                $script:Pa11yUrlVal = Read-Prompt "pa11y webservice URL" "http://localhost:3000"
            }
            "2" {
                $script:Pa11yDockerVal = $true
                $script:Pa11yUrlVal = "http://localhost:3000"
                Write-Ok "Will create pa11y webservice via Docker on port 3000"
            }
            default {
                $script:Pa11yUrlVal = "http://localhost:3000"
                Write-Warn "Skipping pa11y setup. Set DASHBOARD_WEBSERVICE_URL later."
            }
        }
    }

    # Step 3: Modules
    Write-Host ""
    Write-Header "Modules"
    Write-Host "  Core modules (always installed): core, compliance, dashboard"
    Write-Host ""

    if (Read-YesNo "Install the regulatory monitor agent? (watches legal sources for changes)" $false) {
        $script:ModMonitor = $true
        Write-Ok "Monitor agent: enabled"
    }

    # Step 4: Plugins
    Write-Host ""
    Write-Header "Plugins"
    Write-Host "  Plugins extend Luqen with additional capabilities."
    Write-Host "  You can install plugins now or add them later from Admin > Plugins."
    Write-Host ""

    $choice = Read-Choice "Plugin installation:" @(
        "Select plugins individually"
        "Install all plugins"
        "Skip - I'll install plugins later"
    )
    switch ($choice) {
        "1" {
            Write-Host ""
            if (Read-YesNo "  Azure Entra ID SSO (enterprise single sign-on)" $false) {
                $script:PluginAuthEntra = $true
            }
            if (Read-YesNo "  Slack notifications (scan results to Slack channels)" $false) {
                $script:PluginNotifySlack = $true
            }
            if (Read-YesNo "  Teams notifications (scan results to Microsoft Teams)" $false) {
                $script:PluginNotifyTeams = $true
            }
            if (Read-YesNo "  Email reports (scheduled SMTP email delivery)" $true) {
                $script:PluginNotifyEmail = $true
            }
            if (Read-YesNo "  AWS S3 storage (store reports in S3 buckets)" $false) {
                $script:PluginStorageS3 = $true
            }
            if (Read-YesNo "  Azure Blob storage (store reports in Azure)" $false) {
                $script:PluginStorageAzure = $true
            }
        }
        "2" {
            $script:PluginAuthEntra    = $true
            $script:PluginNotifySlack  = $true
            $script:PluginNotifyTeams  = $true
            $script:PluginNotifyEmail  = $true
            $script:PluginStorageS3    = $true
            $script:PluginStorageAzure = $true
            Write-Ok "All plugins selected"
        }
        default {
            Write-Info "No plugins selected. Install from Admin > Plugins later."
        }
    }

    # Step 5: Ports
    Write-Host ""
    Write-Header "Configuration"

    $script:CompliancePort = [int](Read-Prompt "Compliance service port" $script:CompliancePort)
    $script:DashboardPort = $script:CompliancePort + 1000
    $script:DashboardPort = [int](Read-Prompt "Dashboard port" $script:DashboardPort)
    $script:InstallDirVal = Read-Prompt "Installation directory" $script:InstallDirVal

    # Step 6: Admin user
    Write-Host ""
    Write-Header "Admin Account"
    Write-Host "  Create the first admin user now, or log in with the API key later."
    Write-Host ""

    if (Read-YesNo "Create an admin user now?" $true) {
        $script:AdminUsername = Read-Prompt "Admin username" "admin"
        while ($true) {
            Write-Host "  Admin password (min 8 chars): " -NoNewline
            $securePass = Read-Host -AsSecureString
            $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
            $script:AdminPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
            if ($script:AdminPassword.Length -ge 8) { break }
            Write-Warn "Password must be at least 8 characters. Try again."
        }
        Write-Ok "Admin user will be created after installation."
    }

    # Step 7: Summary
    Write-Host ""
    Write-Header "Installation Summary"

    $fmt = "  {0,-24} {1}"
    Write-Host ($fmt -f "Deployment:", $script:DockerMode)
    Write-Host ($fmt -f "Install directory:", $script:InstallDirVal)
    Write-Host ($fmt -f "Compliance port:", $script:CompliancePort)
    Write-Host ($fmt -f "Dashboard port:", $script:DashboardPort)
    Write-Host ($fmt -f "pa11y webservice:", $script:Pa11yUrlVal)
    if ($script:Pa11yDockerVal) {
        Write-Host ($fmt -f "pa11y Docker:", "yes (will be created)")
    }
    Write-Host ($fmt -f "Monitor agent:", $(if ($script:ModMonitor) { "yes" } else { "no" }))

    $pluginsList = @()
    if ($script:PluginAuthEntra)    { $pluginsList += "entra" }
    if ($script:PluginNotifySlack)  { $pluginsList += "slack" }
    if ($script:PluginNotifyTeams)  { $pluginsList += "teams" }
    if ($script:PluginNotifyEmail)  { $pluginsList += "email" }
    if ($script:PluginStorageS3)    { $pluginsList += "s3" }
    if ($script:PluginStorageAzure) { $pluginsList += "azure" }
    $pluginsStr = if ($pluginsList.Count -eq 0) { "none" } else { $pluginsList -join " " }
    Write-Host ($fmt -f "Plugins:", $pluginsStr)

    if ($script:AdminUsername) {
        Write-Host ($fmt -f "Admin user:", $script:AdminUsername)
    }

    Write-Host ""
    if (-not (Read-YesNo "Proceed with installation?" $true)) {
        Write-Info "Installation cancelled."
        exit 0
    }
}

# ──────────────────────────────────────────────
# Shared: clone or pull repo
# ──────────────────────────────────────────────
function Invoke-CloneOrPull {
    $gitDir = Join-Path $script:InstallDirVal ".git"
    if (Test-Path $gitDir) {
        Write-Info "Repository already exists at $($script:InstallDirVal) - pulling latest changes..."
        git -C $script:InstallDirVal pull --ff-only
        if ($LASTEXITCODE -ne 0) { Write-Err "Failed to pull latest changes."; exit 1 }
        Write-Ok "Repository updated."
    } else {
        Write-Info "Cloning repository to $($script:InstallDirVal)..."
        git clone $script:RepoUrl $script:InstallDirVal
        if ($LASTEXITCODE -ne 0) { Write-Err "Failed to clone repository."; exit 1 }
        Write-Ok "Repository cloned."
    }
}

# ──────────────────────────────────────────────
# pa11y Docker setup
# ──────────────────────────────────────────────
function Initialize-Pa11yDocker {
    if (-not $script:Pa11yDockerVal) { return }

    Write-Header "Setting up pa11y webservice (Docker)"

    $running = docker ps --format "{{.Names}}" 2>$null | Where-Object { $_ -eq "pa11y-webservice" }
    if ($running) {
        Write-Warn "pa11y-webservice container already running."
        return
    }

    Write-Info "Starting pa11y webservice with MongoDB..."
    docker network create luqen-net 2>$null | Out-Null

    # MongoDB for pa11y
    docker run -d `
        --name pa11y-mongo `
        --network luqen-net `
        --restart unless-stopped `
        -v pa11y-mongo-data:/data/db `
        mongo:7 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn "pa11y-mongo may already exist" }

    # pa11y webservice
    docker run -d `
        --name pa11y-webservice `
        --network luqen-net `
        --restart unless-stopped `
        -p 3000:3000 `
        -e "DATABASE=mongodb://pa11y-mongo:27017/pa11y-webservice" `
        pa11y/pa11y-webservice 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn "pa11y-webservice may already exist" }

    # Wait for health
    Write-Info "Waiting for pa11y webservice to be ready..."
    $attempts = 0
    while ($true) {
        try {
            $null = Invoke-RestMethod -Uri "http://localhost:3000/api/tasks" -TimeoutSec 2 -ErrorAction SilentlyContinue
            break
        } catch {
            $attempts++
            if ($attempts -ge 20) {
                Write-Err "pa11y webservice did not start. Check: docker logs pa11y-webservice"
                return
            }
            Write-Host "." -NoNewline
            Start-Sleep -Seconds 2
        }
    }
    Write-Host ""
    Write-Ok "pa11y webservice running at http://localhost:3000"
}

# ──────────────────────────────────────────────
# Plugin activation (post-install)
# ──────────────────────────────────────────────
function Install-LuqenPlugin {
    param([string]$ApiKey, [string]$PackageName, [string]$Label)

    $baseUrl = "http://localhost:$($script:DashboardPort)"
    Write-Info "  Installing $Label..."

    try {
        $body = @{ packageName = $PackageName } | ConvertTo-Json
        $result = Invoke-RestMethod -Uri "$baseUrl/api/v1/plugins/install" `
            -Method Post `
            -Headers @{ Authorization = "Bearer $ApiKey"; "Content-Type" = "application/json" } `
            -Body $body `
            -TimeoutSec 30 `
            -ErrorAction SilentlyContinue
        Write-Ok "  $Label installed"
    } catch {
        Write-Warn "  ${Label}: install skipped or failed"
    }
}

function Invoke-ActivatePlugins {
    param([string]$ApiKey)

    Write-Info "Installing selected plugins..."

    if ($script:PluginAuthEntra)    { Install-LuqenPlugin -ApiKey $ApiKey -PackageName "@luqen/plugin-auth-entra"    -Label "Entra ID SSO" }
    if ($script:PluginNotifySlack)  { Install-LuqenPlugin -ApiKey $ApiKey -PackageName "@luqen/plugin-notify-slack"  -Label "Slack notifications" }
    if ($script:PluginNotifyTeams)  { Install-LuqenPlugin -ApiKey $ApiKey -PackageName "@luqen/plugin-notify-teams"  -Label "Teams notifications" }
    if ($script:PluginNotifyEmail)  { Install-LuqenPlugin -ApiKey $ApiKey -PackageName "@luqen/plugin-notify-email"  -Label "Email reports" }
    if ($script:PluginStorageS3)    { Install-LuqenPlugin -ApiKey $ApiKey -PackageName "@luqen/plugin-storage-s3"    -Label "S3 storage" }
    if ($script:PluginStorageAzure) { Install-LuqenPlugin -ApiKey $ApiKey -PackageName "@luqen/plugin-storage-azure" -Label "Azure Blob storage" }
}

# ──────────────────────────────────────────────
# Create admin user (post-install)
# ──────────────────────────────────────────────
function New-AdminUser {
    param([string]$ApiKey)

    if ([string]::IsNullOrEmpty($script:AdminUsername)) { return }

    $baseUrl = "http://localhost:$($script:DashboardPort)"
    Write-Info "Creating admin user '$($script:AdminUsername)'..."

    try {
        $body = @{
            username = $script:AdminUsername
            password = $script:AdminPassword
            role     = "admin"
        } | ConvertTo-Json

        $result = Invoke-RestMethod -Uri "$baseUrl/api/v1/setup" `
            -Method Post `
            -Headers @{ Authorization = "Bearer $ApiKey"; "Content-Type" = "application/json" } `
            -Body $body `
            -TimeoutSec 15 `
            -ErrorAction SilentlyContinue

        Write-Ok "Admin user '$($script:AdminUsername)' created."
    } catch {
        Write-Warn "Could not create admin user: $($_.Exception.Message)"
    }
}

# ──────────────────────────────────────────────
# Generate .luqen.json config
# ──────────────────────────────────────────────
function New-LuqenConfig {
    $configFile = Join-Path $script:InstallDirVal ".luqen.json"
    if (Test-Path $configFile) {
        Write-Warn "Config file already exists at $configFile - skipping."
        return
    }

    $config = @{
        complianceUrl = "http://localhost:$($script:CompliancePort)"
        dashboardUrl  = "http://localhost:$($script:DashboardPort)"
        webserviceUrl = $script:Pa11yUrlVal
        outputDir     = "./luqen-reports"
        monitor       = $script:ModMonitor
    } | ConvertTo-Json -Depth 2

    Set-Content -Path $configFile -Value $config -Encoding UTF8
    Write-Ok "Configuration written to $configFile"
}

# ──────────────────────────────────────────────
# LOCAL DEPLOYMENT
# ──────────────────────────────────────────────
function Install-Local {
    Write-Header "Luqen - Local Installation"

    # Prerequisites
    Write-Info "Checking prerequisites..."

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Err "Node.js is not installed. Please install Node.js 20+ from https://nodejs.org"
        exit 1
    }
    $nodeVersion = (node -e "process.stdout.write(process.versions.node)") 2>$null
    $nodeMajor = [int]($nodeVersion -split '\.')[0]
    if ($nodeMajor -lt 20) {
        Write-Err "Node.js 20+ is required. Found: v$nodeVersion"
        exit 1
    }
    Write-Ok "Node.js v$nodeVersion detected."

    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmCmd) { Write-Err "npm is not installed."; exit 1 }
    $npmVersion = (npm --version) 2>$null
    Write-Ok "npm $npmVersion detected."

    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCmd) { Write-Err "git is not installed."; exit 1 }
    $gitVersion = (git --version) -replace "git version ", ""
    Write-Ok "git $gitVersion detected."

    # pa11y Docker (if requested)
    Initialize-Pa11yDocker

    # Clone / Pull
    Invoke-CloneOrPull
    Push-Location $script:InstallDirVal

    try {
        # npm install
        Write-Info "Installing npm dependencies..."
        npm install --prefer-offline 2>&1 | Select-Object -Last 3
        if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed."; exit 1 }
        Write-Ok "Dependencies installed."

        # Build
        Write-Info "Building all packages..."
        npm run build --workspaces 2>&1 | Where-Object { $_ -match "(error|warning|Built|tsc|done)" }
        Write-Ok "Build complete."

        # JWT keys
        $keysDir = Join-Path $script:InstallDirVal "packages\compliance\keys"
        if (Test-Path (Join-Path $keysDir "private.pem")) {
            Write-Warn "JWT keys already exist - skipping generation."
        } else {
            Write-Info "Generating JWT RS256 key pair..."
            New-Item -ItemType Directory -Path $keysDir -Force | Out-Null
            Push-Location (Join-Path $script:InstallDirVal "packages\compliance")
            node dist/cli.js keys generate
            Pop-Location
            Write-Ok "JWT keys generated."
        }

        # Seed
        if ($script:Seed) {
            Write-Info "Seeding baseline compliance data..."
            Push-Location (Join-Path $script:InstallDirVal "packages\compliance")
            node dist/cli.js seed
            Pop-Location
            Write-Ok "Baseline data seeded (58 jurisdictions, 62 regulations)."
        }

        # OAuth client
        $clientCache = Join-Path $script:InstallDirVal ".install-client"
        $clientId = ""
        $clientSecret = ""
        if (Test-Path $clientCache) {
            $cacheContent = Get-Content $clientCache
            foreach ($line in $cacheContent) {
                if ($line -match "^client_id=(.+)$")     { $clientId = $Matches[1] }
                if ($line -match "^client_secret=(.+)$") { $clientSecret = $Matches[1] }
            }
        } else {
            Write-Info "Creating OAuth2 client..."
            Push-Location (Join-Path $script:InstallDirVal "packages\compliance")
            $clientOut = node dist/cli.js clients create --name "luqen-dashboard" --scope "read write" 2>&1
            Pop-Location
            foreach ($line in $clientOut) {
                if ($line -match "client_id:\s*(\S+)")     { $clientId = $Matches[1] }
                if ($line -match "client_secret:\s*(\S+)") { $clientSecret = $Matches[1] }
            }
            Set-Content -Path $clientCache -Value "client_id=$clientId`nclient_secret=$clientSecret" -Encoding UTF8
            Write-Ok "OAuth2 client created."
        }

        # Generate config
        New-LuqenConfig

        # Session secret
        $sessionSecret = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"

        # Start services for post-install
        Write-Info "Starting services for post-install setup..."

        $compLogFile = Join-Path $env:TEMP "luqen-comp-install.log"
        $dashLogFile = Join-Path $env:TEMP "luqen-dash-install.log"

        $env:COMPLIANCE_API_KEY = "setup-temp-key"
        $compProcess = Start-Process -FilePath "node" `
            -ArgumentList "packages\compliance\dist\cli.js", "serve", "--port", $script:CompliancePort `
            -WorkingDirectory $script:InstallDirVal `
            -RedirectStandardOutput $compLogFile `
            -RedirectStandardError (Join-Path $env:TEMP "luqen-comp-err.log") `
            -PassThru -WindowStyle Hidden

        Start-Sleep -Seconds 3

        $env:DASHBOARD_SESSION_SECRET = $sessionSecret
        $env:DASHBOARD_COMPLIANCE_URL = "http://localhost:$($script:CompliancePort)"
        $env:DASHBOARD_COMPLIANCE_API_KEY = "setup-temp-key"
        $env:DASHBOARD_WEBSERVICE_URL = $script:Pa11yUrlVal
        $env:DASHBOARD_COMPLIANCE_CLIENT_ID = $clientId
        $env:DASHBOARD_COMPLIANCE_CLIENT_SECRET = $clientSecret

        $dashProcess = Start-Process -FilePath "node" `
            -ArgumentList "packages\dashboard\dist\cli.js", "serve", "--port", $script:DashboardPort `
            -WorkingDirectory $script:InstallDirVal `
            -RedirectStandardOutput $dashLogFile `
            -RedirectStandardError (Join-Path $env:TEMP "luqen-dash-err.log") `
            -PassThru -WindowStyle Hidden

        Start-Sleep -Seconds 4

        # Grab the generated API key
        $apiKey = ""
        if (Test-Path $dashLogFile) {
            $dashLog = Get-Content $dashLogFile -Raw
            if ($dashLog -match "API Key: ([a-f0-9]{64})") {
                $apiKey = $Matches[1]
            }
        }

        if ($apiKey) {
            New-AdminUser -ApiKey $apiKey
            Invoke-ActivatePlugins -ApiKey $apiKey
        }

        # Stop temp services
        try { Stop-Process -Id $compProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
        try { Stop-Process -Id $dashProcess.Id -Force -ErrorAction SilentlyContinue } catch {}

        # Clean up env vars
        Remove-Item Env:\COMPLIANCE_API_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\DASHBOARD_SESSION_SECRET -ErrorAction SilentlyContinue
        Remove-Item Env:\DASHBOARD_COMPLIANCE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:\DASHBOARD_COMPLIANCE_API_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\DASHBOARD_WEBSERVICE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:\DASHBOARD_COMPLIANCE_CLIENT_ID -ErrorAction SilentlyContinue
        Remove-Item Env:\DASHBOARD_COMPLIANCE_CLIENT_SECRET -ErrorAction SilentlyContinue

        # Print quickstart
        Write-Host ""
        Write-Host "  =======================================================" -ForegroundColor Green
        Write-Host "    Luqen installed successfully!" -ForegroundColor Green
        Write-Host "  =======================================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Installation directory: " -NoNewline; Write-Host $script:InstallDirVal -ForegroundColor White
        Write-Host ""
        Write-Host "  Start services:" -ForegroundColor White
        Write-Host ""
        Write-Host "    # Option A: Start both services (recommended)"
        Write-Host "    cd $($script:InstallDirVal)"
        Write-Host "    npm run dev:all"
        Write-Host ""
        Write-Host "    # Option B: Start individually"
        Write-Host "    cd $($script:InstallDirVal)\packages\compliance"
        Write-Host "    `$env:COMPLIANCE_PORT=$($script:CompliancePort); node dist\cli.js serve"
        Write-Host ""
        Write-Host "    cd $($script:InstallDirVal)\packages\dashboard"
        Write-Host "    `$env:DASHBOARD_PORT=$($script:DashboardPort); node dist\cli.js serve"
        Write-Host ""
        Write-Host "  Access:" -ForegroundColor White
        Write-Host ""
        Write-Host "    Dashboard:  " -NoNewline; Write-Host "http://localhost:$($script:DashboardPort)" -ForegroundColor Cyan
        Write-Host "    Compliance: " -NoNewline; Write-Host "http://localhost:$($script:CompliancePort)" -ForegroundColor Cyan

        if ($script:AdminUsername) {
            Write-Host "    Login:      " -NoNewline; Write-Host "$($script:AdminUsername) / (your password)" -ForegroundColor White
        }

        if ($apiKey) {
            Write-Host ""
            Write-Host "  API Key:      " -NoNewline; Write-Host $apiKey -ForegroundColor Yellow
            Write-Host "                (also works for login - save it securely)"
        }

        Write-Host ""
        Write-Host "  pa11y:        $($script:Pa11yUrlVal)"
        Write-Host ""

    } finally {
        Pop-Location
    }
}

# ──────────────────────────────────────────────
# DOCKER DEPLOYMENT
# ──────────────────────────────────────────────
function Install-Docker {
    Write-Header "Luqen - Docker Installation"

    # Prerequisites
    Write-Info "Checking prerequisites..."

    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Err "Docker is not installed. Get it from https://docs.docker.com/get-docker/"
        exit 1
    }
    $dockerVersion = (docker --version) -replace "Docker version ", "" -replace ",.*", ""
    Write-Ok "Docker $dockerVersion detected."

    # Check for Docker Compose
    $composeCmd = ""
    try {
        docker compose version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $composeCmd = "docker compose" }
    } catch {}
    if (-not $composeCmd) {
        $dcCmd = Get-Command docker-compose -ErrorAction SilentlyContinue
        if ($dcCmd) { $composeCmd = "docker-compose" }
    }
    if (-not $composeCmd) {
        Write-Err "Docker Compose is not installed."
        exit 1
    }
    Write-Ok "Docker Compose detected."

    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCmd) { Write-Err "git is not installed."; exit 1 }
    Write-Ok "git detected."

    # pa11y Docker (if requested)
    Initialize-Pa11yDocker

    # Clone / Pull
    Invoke-CloneOrPull
    Push-Location $script:InstallDirVal

    try {
        # Configure .env
        $envFile = Join-Path $script:InstallDirVal ".env"
        $envContent = @{}
        if (Test-Path $envFile) {
            foreach ($line in (Get-Content $envFile)) {
                if ($line -match "^([^#=]+)=(.*)$") {
                    $envContent[$Matches[1].Trim()] = $Matches[2].Trim()
                }
            }
        }

        $envContent["LUQEN_WEBSERVICE_URL"] = $script:Pa11yUrlVal
        if ($script:CompliancePort -ne 4000) { $envContent["COMPLIANCE_PORT"] = $script:CompliancePort }
        if ($script:DashboardPort -ne 5000)  { $envContent["DASHBOARD_PORT"]  = $script:DashboardPort }

        $envLines = $envContent.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
        Set-Content -Path $envFile -Value ($envLines -join "`n") -Encoding UTF8
        Write-Ok ".env configured."

        # Select docker-compose template
        $templateFile = Join-Path $script:InstallDirVal "deploy\templates\docker-compose.$($script:DeployTemplate).yml"
        $composeFile = Join-Path $script:InstallDirVal "docker-compose.yml"
        if (Test-Path $templateFile) {
            Write-Info "Using $($script:DeployTemplate) deployment template..."
            Copy-Item -Path $templateFile -Destination $composeFile -Force
            Write-Ok "docker-compose.yml generated from $($script:DeployTemplate) template."
        } else {
            Write-Info "Using existing docker-compose.yml"
        }

        # Docker Compose up
        Write-Info "Building and starting containers..."
        if ($composeCmd -eq "docker compose") {
            docker compose up -d --build
        } else {
            docker-compose up -d --build
        }
        if ($LASTEXITCODE -ne 0) { Write-Err "Docker Compose failed."; exit 1 }
        Write-Ok "Containers started."

        # Wait for health
        Write-Info "Waiting for services to be healthy..."
        $attempts = 0
        while ($true) {
            try {
                $null = Invoke-RestMethod -Uri "http://localhost:$($script:DashboardPort)/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
                break
            } catch {
                $attempts++
                if ($attempts -ge 30) {
                    Write-Err "Services did not become healthy. Check: $composeCmd logs"
                    exit 1
                }
                Write-Host "." -NoNewline
                Start-Sleep -Seconds 3
            }
        }
        Write-Host ""
        Write-Ok "Services are healthy."

        # Seed
        if ($script:Seed) {
            Write-Info "Seeding baseline data..."
            docker exec luqen-compliance node dist/cli.js seed 2>$null
            Write-Ok "Baseline data seeded."
        }

        # Grab API key
        $apiKey = ""
        if ($composeCmd -eq "docker compose") {
            $logs = docker compose logs dashboard 2>$null
        } else {
            $logs = docker-compose logs dashboard 2>$null
        }
        $logsStr = $logs -join "`n"
        if ($logsStr -match "API Key: ([a-f0-9]{64})") {
            $apiKey = $Matches[1]
        }

        if ($apiKey) {
            New-AdminUser -ApiKey $apiKey
            Invoke-ActivatePlugins -ApiKey $apiKey
        }

        # Generate config
        New-LuqenConfig

        # Print summary
        Write-Host ""
        Write-Host "  =======================================================" -ForegroundColor Green
        Write-Host "    Luqen (Docker) installed successfully!" -ForegroundColor Green
        Write-Host "  =======================================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Access:" -ForegroundColor White
        Write-Host ""
        Write-Host "    Dashboard:  " -NoNewline; Write-Host "http://localhost:$($script:DashboardPort)" -ForegroundColor Cyan
        Write-Host "    Compliance: " -NoNewline; Write-Host "http://localhost:$($script:CompliancePort)" -ForegroundColor Cyan

        if ($script:AdminUsername) {
            Write-Host "    Login:      " -NoNewline; Write-Host "$($script:AdminUsername) / (your password)" -ForegroundColor White
        }

        if ($apiKey) {
            Write-Host ""
            Write-Host "  API Key:      " -NoNewline; Write-Host $apiKey -ForegroundColor Yellow
        }

        Write-Host ""
        Write-Host "  Commands:" -ForegroundColor White
        Write-Host ""
        Write-Host "    View logs:  $composeCmd -f $($script:InstallDirVal)\docker-compose.yml logs -f"
        Write-Host "    Stop:       $composeCmd -f $($script:InstallDirVal)\docker-compose.yml down"
        Write-Host "    Restart:    $composeCmd -f $($script:InstallDirVal)\docker-compose.yml restart"
        Write-Host "    Update:     cd $($script:InstallDirVal); git pull; $composeCmd up -d --build"
        Write-Host ""

    } finally {
        Pop-Location
    }
}

# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

# Run wizard if interactive and no deployment mode specified
if ($script:Interactive -and [string]::IsNullOrEmpty($script:DockerMode) -and [Environment]::UserInteractive) {
    Invoke-Wizard
}

# Default to local if still not set
if ([string]::IsNullOrEmpty($script:DockerMode))  { $script:DockerMode = "local" }
if ([string]::IsNullOrEmpty($script:Pa11yUrlVal))  { $script:Pa11yUrlVal = "http://localhost:3000" }

if ($script:DockerMode -eq "docker") {
    Install-Docker
} else {
    Install-Local
}
