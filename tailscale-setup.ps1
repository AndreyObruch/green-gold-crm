# Установка Tailscale на сервере (PowerShell от администратора)
winget install --id=Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements

# Запуск службы и вход в аккаунт
Start-Service tailscaled
tailscale up

# Проверка IP внутри VPN сети
Write-Host "Tailscale IP:" -ForegroundColor Cyan
(tailscale ip -4).Trim() + ":3000" | Out-File -FilePath "$PWD\tailscale-address.txt" -Encoding utf8
Write-Host "Адрес для коллег сохранен в tailscale-address.txt" -ForegroundColor Green