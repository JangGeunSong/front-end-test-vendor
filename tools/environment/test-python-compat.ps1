[CmdletBinding()]
param(
    [string[]]$PythonVersions = @('3.12', '3.13', '3.14')
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$requirements = Join-Path $repositoryRoot 'tools\ai-generator\requirements.txt'
$previousMvpPython = $env:MVP_PYTHON

function Invoke-Checked {
    param([string]$Label, [scriptblock]$Command)
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

Push-Location $repositoryRoot
try {
    foreach ($version in $PythonVersions) {
        $suffix = $version.Replace('.', '')
        $environment = ".venv-py$suffix"
        $python = Join-Path $repositoryRoot "$environment\Scripts\python.exe"

        Write-Host "== Python $version =="
        Invoke-Checked 'uv python install' { uv python install $version }
        Invoke-Checked 'uv venv' { uv venv $environment --python $version --clear }
        Invoke-Checked 'wheel-only dependency sync' {
            uv pip sync --python $python $requirements --strict --only-binary ':all:'
        }
        Invoke-Checked 'dependency check' { uv pip check --python $python }
        Invoke-Checked 'normal imports' {
            & $python -c "import cryptography, dotenv, google.generativeai, grpc, pydantic, requests; print('imports-ok')"
        }
        Invoke-Checked 'Python syntax check' { & $python -m compileall -q tools/ai-generator }
        Invoke-Checked 'Python tests' {
            & $python -m unittest discover -s tools/ai-generator -p 'test*.py' -v
        }

        $env:MVP_PYTHON = $python
        Invoke-Checked 'npm MVP test' { & npm.cmd run product:mvp:test }
    }
}
finally {
    $env:MVP_PYTHON = $previousMvpPython
    Pop-Location
}
