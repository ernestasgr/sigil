$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail-Bootstrap {
    param([string]$Message)

    Write-Error "BOOTSTRAP FAILURE: $Message"
    exit 1
}

try {
    if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
        Fail-Bootstrap 'Node.js was not found on PATH after setup.'
    }

    $nodeVersionCheck = @(& node scripts/check-node-version.mjs 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Fail-Bootstrap ($nodeVersionCheck -join [Environment]::NewLine)
    }
    Write-Host ($nodeVersionCheck -join [Environment]::NewLine)

    if ($null -eq (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Fail-Bootstrap 'pnpm was not found on PATH after setup.'
    }

    if ($null -eq (Get-Command python -ErrorAction SilentlyContinue)) {
        Fail-Bootstrap 'Python 3 must be available on PATH for node-gyp.'
    }

    $pythonVersion = (python --version 2>&1 | Out-String).Trim()
    Write-Host "BOOTSTRAP: Python $pythonVersion"

    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) {
        Fail-Bootstrap 'Visual Studio 2022 Build Tools with the C++ workload was not found.'
    }

    $installationPath = (& $vswhere -latest -products '*' -requires 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' -property installationPath | Select-Object -First 1 | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($installationPath)) {
        Fail-Bootstrap 'The Visual Studio C++ toolchain (MSVC v143) was not found.'
    }

    Write-Host "BOOTSTRAP: Visual Studio C++ toolchain $installationPath"
    Write-Host 'BOOTSTRAP OK: Node.js, pnpm, Python, and the Visual Studio C++ toolchain are available.'
}
catch {
    Write-Error "BOOTSTRAP FAILURE: $($_.Exception.Message)"
    exit 1
}
