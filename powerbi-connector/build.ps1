<#
.SYNOPSIS
    Builds the Luqen Power BI custom connector (.mez file).

.DESCRIPTION
    Packages the Power Query connector files into a .mez archive that can be
    installed in Power BI Desktop. The .mez format is a ZIP file containing
    the .pq source, icon resources, and metadata.

.PARAMETER OutputDir
    Directory where the .mez file will be created. Defaults to ./bin.

.EXAMPLE
    .\build.ps1
    .\build.ps1 -OutputDir "C:\connectors"
#>

param(
    [string]$OutputDir = (Join-Path $PSScriptRoot "bin")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$connectorName = "Luqen"
$sourceDir = $PSScriptRoot
$stagingDir = Join-Path $sourceDir ".staging"
$mezFile = Join-Path $OutputDir "$connectorName.mez"

# ---------------------------------------------------------------------------
# Clean previous artifacts
# ---------------------------------------------------------------------------

if (Test-Path $stagingDir) {
    Remove-Item $stagingDir -Recurse -Force
}
if (Test-Path $mezFile) {
    Remove-Item $mezFile -Force
}

New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagingDir "resources") -Force | Out-Null

# ---------------------------------------------------------------------------
# Copy required files to staging
# ---------------------------------------------------------------------------

$requiredFiles = @(
    "$connectorName.pq"
)

foreach ($file in $requiredFiles) {
    $src = Join-Path $sourceDir $file
    if (-not (Test-Path $src)) {
        Write-Error "Required file not found: $src"
        exit 1
    }
    Copy-Item $src -Destination $stagingDir
}

# Copy icon if it exists (optional — connector works without it)
$iconSrc = Join-Path $sourceDir "resources\$connectorName.png"
if (Test-Path $iconSrc) {
    Copy-Item $iconSrc -Destination (Join-Path $stagingDir "resources\$connectorName.png")
    Write-Host "  Included icon: resources/$connectorName.png"
} else {
    Write-Warning "Icon not found at resources/$connectorName.png — connector will use default icon."
    # Create a minimal 1x1 transparent PNG so the connector loads without error
    $pngBytes = [Convert]::FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    )
    [System.IO.File]::WriteAllBytes(
        (Join-Path $stagingDir "resources\$connectorName.png"),
        $pngBytes
    )
    Write-Host "  Created placeholder icon."
}

# ---------------------------------------------------------------------------
# Create .mez (ZIP) archive
# ---------------------------------------------------------------------------

Write-Host "Building $connectorName.mez ..."

Compress-Archive -Path (Join-Path $stagingDir "*") -DestinationPath $mezFile -Force

# ---------------------------------------------------------------------------
# Cleanup staging
# ---------------------------------------------------------------------------

Remove-Item $stagingDir -Recurse -Force

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

$fileInfo = Get-Item $mezFile
Write-Host ""
Write-Host "Build complete:" -ForegroundColor Green
Write-Host "  Output : $mezFile"
Write-Host "  Size   : $([math]::Round($fileInfo.Length / 1KB, 1)) KB"
Write-Host ""
Write-Host "Install by copying to:"
Write-Host "  [Documents]\Power BI Desktop\Custom Connectors\"
Write-Host ""
