# Inicia toda a plataforma Bella AI: PostgreSQL, API, painel web e túnel público.
# Uso: clique com o botão direito > "Executar com o PowerShell", ou rode .\iniciar-bella.ps1

$ErrorActionPreference = 'Continue'
$raiz = $PSScriptRoot
$pgCtl = "$env:LOCALAPPDATA\bella-pg\pgsql\bin\pg_ctl.exe"
$cloudflared = "$env:LOCALAPPDATA\bella-tools\cloudflared.exe"

function Test-Porta($porta) {
  return [bool](Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue)
}

Write-Host "=== BELLA AI ===" -ForegroundColor Green

# 1. PostgreSQL
if (Test-Porta 5432) {
  Write-Host "[1/4] PostgreSQL já está no ar."
} else {
  Write-Host "[1/4] Iniciando PostgreSQL..."
  & $pgCtl -D "$env:LOCALAPPDATA\bella-pg\data" -l "$env:LOCALAPPDATA\bella-pg\postgres.log" -w start | Out-Null
}

# 2. API (porta 3002)
if (Test-Porta 3002) {
  Write-Host "[2/4] API já está no ar (porta 3002)."
} else {
  Write-Host "[2/4] Iniciando API (porta 3002)..."
  Start-Process node -ArgumentList 'dist/main.js' -WorkingDirectory "$raiz\apps\api" -WindowStyle Minimized
}

# 3. Painel web (porta 3000)
if (Test-Porta 3000) {
  Write-Host "[3/4] Painel web já está no ar (porta 3000)."
} else {
  Write-Host "[3/4] Iniciando painel web (porta 3000)..."
  Start-Process cmd -ArgumentList '/c npm run start' -WorkingDirectory "$raiz\apps\web" -WindowStyle Minimized
}

# 4. Túnel público (endereço muda a cada execução)
Write-Host "[4/4] Criando endereço público..."
$logTunel = "$env:TEMP\bella-tunnel.log"
Remove-Item $logTunel -ErrorAction SilentlyContinue
Start-Process $cloudflared -ArgumentList 'tunnel', '--url', 'http://localhost:3000' -WindowStyle Minimized -RedirectStandardError $logTunel

$url = $null
foreach ($i in 1..30) {
  Start-Sleep -Seconds 1
  if (Test-Path $logTunel) {
    $m = Select-String -Path $logTunel -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
  }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " Acesso local:    http://localhost:3000" -ForegroundColor Cyan
if ($url) {
  Write-Host " Acesso online:   $url" -ForegroundColor Cyan
  Write-Host " (endereço novo a cada inicialização)" -ForegroundColor DarkGray
} else {
  Write-Host " Túnel ainda subindo — veja o endereço em: $logTunel" -ForegroundColor Yellow
}
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "O computador precisa permanecer ligado para o acesso online funcionar."
Start-Process 'http://localhost:3000/login'
