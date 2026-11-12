# Установка Tailscale через официальный инсталлятор (EXE)
$installerUrl = "https://pkgs.tailscale.com/stable/windows/tailscale-amd64.exe"
$tempExe = "$env:TEMP\tailscale-installer.exe"

Write-Host "Downloading Tailscale installer..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri $installerUrl -OutFile $tempExe -UseBasicParsing
} catch {
    Write-Host "Download failed. Please download manually from https://tailscale.com/download/windows" -ForegroundColor Red
    exit 1
}

Write-Host "Installing Tailscale silently..." -ForegroundColor Cyan
Start-Process $tempExe -ArgumentList "/SILENT", "/NORESTART" -Wait

Remove-Item $tempExe -Force -ErrorAction SilentlyContinue

# Добавление пути к Tailscale в текущую сессию PowerShell
$tailscalePath = "$env:ProgramFiles\Tailscale\tailscale.exe"
if (-not (Test-Path $tailscalePath)) {
    Write-Host "Tailscale executable not found at expected path." -ForegroundColor Red
    exit 1
}
$env:Path += ";$env:ProgramFiles\Tailscale"

# Запуск службы и вход в аккаунт
Write-Host "Starting service..." -ForegroundColor Green
Start-Service tailscaled

Write-Host "Running tailscale up..." -ForegroundColor Yellow
& $tailscalePath up

# Проверка IP внутри VPN сети
Write-Host "Tailscale IP:" -ForegroundColor Cyan
$ip = (& $tailscalePath ip -4).Trim()
if ($ip) {
    Write-Host "Address for colleagues: http://$ip`:3000" -ForegroundColor Green
    "http://$ip`:3000" | Out-File -FilePath "$PWD\tailscale-address.txt" -Encoding utf8
} else {
    Write-Host "Failed to get Tailscale IP. Check connection." -ForegroundColor Red
}