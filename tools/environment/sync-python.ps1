[CmdletBinding()]
param(
    [string]$PythonVersion,
    [switch]$Recreate
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$requirements = Join-Path $repositoryRoot 'tools\ai-generator\requirements.txt'
$environment = Join-Path $repositoryRoot '.venv'
$environmentPython = Join-Path $environment 'Scripts\python.exe'

Push-Location $repositoryRoot
try {
    if (-not $PythonVersion) {
        $PythonVersion = (Get-Content -Raw -Encoding UTF8 '.python-version').Trim()
    }

    & uv python install $PythonVersion
    if ($LASTEXITCODE -ne 0) { throw "uv python install failed with exit code $LASTEXITCODE" }

    if ($Recreate -or -not (Test-Path $environmentPython)) {
        & uv venv .venv --python $PythonVersion --clear
        if ($LASTEXITCODE -ne 0) { throw "uv venv failed with exit code $LASTEXITCODE" }
    }

    $actualMinor = & $environmentPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the project Python interpreter.' }
    if ($actualMinor.Trim() -ne $PythonVersion) {
        throw "Existing .venv uses Python $actualMinor; run npm run env:recreate."
    }

    & uv pip sync --python $environmentPython $requirements --strict --only-binary ':all:'
    if ($LASTEXITCODE -ne 0) { throw "uv pip sync failed with exit code $LASTEXITCODE" }

    & $environmentPython --version
    & uv pip check --python $environmentPython
    if ($LASTEXITCODE -ne 0) { throw "uv pip check failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}
