# Starts the GlucoIris model server (port 8000) and website (port 5174) in two
# new PowerShell windows, then opens the website.
#   Run from anywhere:  powershell -ExecutionPolicy Bypass -File .\start-glucoiris.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-Port($port) {
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $port); $c.Close(); return $true } catch { return $false }
}

if (Test-Port 8000) {
    Write-Host "Model server already running on port 8000 - reusing it." -ForegroundColor Yellow
} else {
    Start-Process powershell -WorkingDirectory $root -ArgumentList '-NoExit', '-Command', 'python backend/run.py'
    Write-Host "Starting model server on http://localhost:8000 ..."
}

if (Test-Port 5174) {
    Write-Host "Website already running on port 5174 - reusing it." -ForegroundColor Yellow
} else {
    Start-Process powershell -WorkingDirectory (Join-Path $root 'frontend') -ArgumentList '-NoExit', '-Command', 'npm run dev'
    Write-Host "Starting website on http://localhost:5174 ..."
}

# Wait for the website, then open it.
for ($i = 0; $i -lt 40 -and -not (Test-Port 5174); $i++) { Start-Sleep -Milliseconds 500 }
Start-Process 'http://localhost:5174'
Write-Host "GlucoIris: http://localhost:5174  (model server: http://localhost:8000/v1/health)" -ForegroundColor Green
