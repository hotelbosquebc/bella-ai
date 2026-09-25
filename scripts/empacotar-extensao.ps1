# Empacota a extensao da Bella para instalar no outro PC.
#
# O nome do arquivo e da pasta NUNCA muda: o Chrome guarda o CAMINHO da pasta,
# e se ele muda a extensao "some" e precisa ser reinstalada (e o login se
# perde). Por isso nada de versao no nome - o dono so substitui o arquivo.
#
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\empacotar-extensao.ps1

$ErrorActionPreference = 'Stop'
$repo    = Split-Path -Parent $PSScriptRoot
$origem  = Join-Path $repo 'whatsapp-extension'
$nome    = 'Bella-Extensao-WhatsApp'
$destino = Join-Path ([Environment]::GetFolderPath('Desktop')) "$nome.zip"
$temp    = Join-Path $env:TEMP "bella-pacote-$(Get-Random)"
$pasta   = Join-Path $temp $nome

# Nao empacota extensao quebrada: em 23/09/2026 uma edicao apagou 213 linhas
# do content.js e foi para a maquina do hotel sem ninguem perceber.
node (Join-Path $PSScriptRoot "verificar-extensao.js")
if ($LASTEXITCODE -ne 0) { throw "Extensao com problema - veja acima. Nada foi empacotado." }

New-Item -ItemType Directory -Force -Path $pasta | Out-Null
Copy-Item "$origem\*" -Destination $pasta -Recurse

if (Test-Path $destino) { Remove-Item $destino }
Compress-Archive -Path $pasta -DestinationPath $destino
Remove-Item -Recurse -Force $temp

$versao = (Get-Content "$origem\manifest.json" | Select-String '"version"').Line.Trim()
$kb = [int]((Get-Item $destino).Length / 1KB)
Write-Output "Gerado: $destino ($kb KB)"
Write-Output "Conteudo: pasta $nome  |  $versao"
Write-Output ""
Write-Output "No outro PC: descompactar direto em C:\ (substituindo a pasta antiga)"
Write-Output "e clicar no botao de recarregar da Bella em chrome://extensions."
