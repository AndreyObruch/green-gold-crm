# Установка Tailscale через MSI (без winget)
$installerUrl = "https://pkgs.tailscale.com/stable/windows/tailscale-amd64.msi"
$tempMsi = "$env:TEMP\tailscale-installer.msi"

Write-Host "Downloading Tailscale installer..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $installerUrl -OutFile $tempMsi -UseBasicParsing

Write-Host "Installing Tailscale silently..." -ForegroundColor Cyan
Start-Process msiexec.exe -ArgumentList "/i `"$tempMsi`" /qn /norestart" -Wait

Remove-Item $tempMsi -Force -ErrorAction SilentlyContinue

# Запуск службы и вход в аккаунт
Write-Host "Starting service..." -ForegroundColor Green
Start-Service tailscaled

Write-Host "Running tailscale up..." -ForegroundColor Yellow
tailscale up

# Проверка IP внутри VPN сети
Write-Host "Tailscale IP:" -ForegroundColor Cyan
$ip = (tailscale ip -4).Trim()
if ($ip) {
    Write-Host "Address for colleagues: http://$ip`:3000" -ForegroundColor Green
    "http://$ip`:3000" | Out-File -FilePath "$PWD\tailscale-address.txt" -Encoding utf8
} else {
    Write-Host "Failed to get Tailscale IP. Check connection." -ForegroundColor Red
}