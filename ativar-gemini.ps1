# Ativa a inteligência da Bella com o Gemini (gratuito).
# Uso:  .\ativar-gemini.ps1 "SUA_CHAVE_AQUI"

param([Parameter(Mandatory = $true)][string]$Chave)

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$envFile = Join-Path $raiz 'apps\api\.env'

# 1. Grava/atualiza a GOOGLE_API_KEY no .env da API
$linhas = Get-Content $envFile | Where-Object { $_ -notmatch '^\s*GOOGLE_API_KEY\s*=' -and $_ -notmatch '^#\s*GOOGLE_API_KEY' }
$linhas += "GOOGLE_API_KEY=$Chave"
$linhas += 'AI_PROVIDER=gemini'
$linhas = $linhas | Where-Object { $_ -notmatch '^\s*AI_PROVIDER\s*=\s*$' -and $_ -notmatch '^#\s*AI_PROVIDER' }
Set-Content -Path $envFile -Value (($linhas | Select-Object -Unique)) -Encoding utf8
Write-Host "Chave gravada em $envFile" -ForegroundColor Green

# 2. Reinicia a API
$c = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue
if ($c) { Stop-Process -Id $c[0].OwningProcess -Force -Confirm:$false }
Start-Process node -ArgumentList 'dist/main.js' -WorkingDirectory "$raiz\apps\api" -WindowStyle Hidden
Start-Sleep -Seconds 7

# 3. Testa com uma mensagem real
$body = '{"from":"5547900000001","name":"Teste Gemini","text":"Ola Bella, voces tem cafe da manha incluso?"}'
Invoke-RestMethod -Method Post -Uri "http://localhost:3002/api/channels/webchat/webhook" -ContentType "application/json" -Body $body | Out-Null
Start-Sleep -Seconds 4
$conv = (Invoke-RestMethod "http://localhost:3002/api/conversations" | Where-Object { $_.guest.phone -eq '5547900000001' })[0]
$detail = Invoke-RestMethod "http://localhost:3002/api/conversations/$($conv.id)"
$resposta = ($detail.messages | Where-Object { $_.sender -eq 'BELLA' })[-1]

Write-Host "`n=== Resposta da Bella ===" -ForegroundColor Cyan
Write-Host $resposta.content
$audit = Invoke-RestMethod "http://localhost:3002/api/audit?conversationId=$($conv.id)"
Write-Host "`nModelo usado: $($audit[0].model)" -ForegroundColor DarkGray
