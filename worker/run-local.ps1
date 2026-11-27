# Runs the recognition worker on this Windows PC (no Docker). Stops when the window / PC closes.
# First time:  python -m venv .venv; .venv\Scripts\python -m pip install numpy opencv-python-headless onnxruntime httpx  (requirements.txt pins are for the Python 3.12 image); .venv\Scripts\python download_models.py
# Needs the Microsoft Visual C++ Redistributable 14.40+ (winget install Microsoft.VCRedist.2015+.x64).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# same settings as the web app
Get-Content "..\web\.env.local" | Where-Object { $_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$' } | ForEach-Object {
    $null = $_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$'
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"'), "Process")
}
$env:MODELS_DIR = Join-Path $PSScriptRoot "models"
$env:PYTHONUNBUFFERED = "1"

& .\.venv\Scripts\python.exe -m recognizer 2>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot "worker.log") -Append
