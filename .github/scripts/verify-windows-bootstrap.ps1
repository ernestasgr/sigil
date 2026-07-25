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

    Write-Host 'BOOTSTRAP OK: Node.js and pnpm are available.'
}
catch {
    Write-Error "BOOTSTRAP FAILURE: $($_.Exception.Message)"
    exit 1
}
