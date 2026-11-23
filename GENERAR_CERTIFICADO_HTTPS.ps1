$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$httpsDir = Join-Path $root 'data\sistema\https'
$publicDir = Join-Path $root 'public'
New-Item -ItemType Directory -Force -Path $httpsDir | Out-Null

Write-Host ''
Write-Host '=== ISIM · Certificado HTTPS local ===' -ForegroundColor Cyan
Write-Host ''

# Detectar las IPv4 reales del equipo (sin adaptadores virtuales).
$ips = @()
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.InterfaceAlias -notmatch 'VMware|VirtualBox|vEthernet|Hyper-V|Tailscale|Loopback|Bluetooth|VPN|TAP|TUN|Docker'
    } |
    Select-Object -ExpandProperty IPAddress -Unique
} catch {
  $ips = @()
}

if (-not $ips -or $ips.Count -eq 0) {
  Write-Host 'No se detecto una IP de red local. Se usara 127.0.0.1.' -ForegroundColor Yellow
  $ips = @('127.0.0.1')
}

Write-Host 'Direcciones incluidas en el certificado:' -ForegroundColor Gray
Write-Host ('  - localhost, isim.local, 127.0.0.1, ' + ($ips -join ', '))
Write-Host ''

# Crear o reutilizar la CA local.
$caSubject = 'CN=ISIM CA Local'
$ca = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.Subject -eq $caSubject -and $_.HasPrivateKey } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $ca) {
  Write-Host 'Creando autoridad certificadora local...' -ForegroundColor Gray
  $ca = New-SelfSignedCertificate `
    -Subject $caSubject `
    -KeyUsage CertSign, CRLSign, DigitalSignature `
    -KeyExportPolicy Exportable `
    -KeyLength 2048 `
    -KeyAlgorithm RSA `
    -HashAlgorithm SHA256 `
    -CertStoreLocation Cert:\CurrentUser\My `
    -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=1') `
    -NotAfter (Get-Date).AddYears(10)
} else {
  Write-Host 'Reutilizando la autoridad certificadora local existente.' -ForegroundColor Gray
}

# Crear el certificado del servidor firmado por la CA.
$sans = @('DNS=localhost', 'DNS=isim.local', 'IPAddress=127.0.0.1')
foreach ($ip in $ips) {
  if ($ip -ne '127.0.0.1') { $sans += "IPAddress=$ip" }
}
$sanText = '2.5.29.17={text}' + ($sans -join '&')

Write-Host 'Creando certificado del servidor...' -ForegroundColor Gray
$server = New-SelfSignedCertificate `
  -Subject 'CN=ISIM' `
  -TextExtension @(
    $sanText,
    '2.5.29.37={text}1.3.6.1.5.5.7.3.1',
    '2.5.29.19={text}ca=0'
  ) `
  -Signer $ca `
  -KeyUsage DigitalSignature, KeyEncipherment `
  -KeyExportPolicy Exportable `
  -KeyLength 2048 `
  -KeyAlgorithm RSA `
  -HashAlgorithm SHA256 `
  -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddYears(5)

# Contrasena aleatoria para el PFX.
$chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$pass = -join (1..32 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
$securePass = ConvertTo-SecureString -String $pass -Force -AsPlainText

$pfxPath = Join-Path $httpsDir 'server.pfx'
$passPath = Join-Path $httpsDir 'passphrase.txt'
$caCerPath = Join-Path $httpsDir 'isim-ca.cer'
$caCerPublicPath = Join-Path $publicDir 'isim-ca.cer'
$caPemPath = Join-Path $publicDir 'isim-ca.crt'

Export-PfxCertificate -Cert $server -FilePath $pfxPath -Password $securePass | Out-Null
[IO.File]::WriteAllText($passPath, $pass, (New-Object Text.UTF8Encoding($false)))
Export-Certificate -Cert $ca -FilePath $caCerPath -Type CERT | Out-Null
Copy-Item -Path $caCerPath -Destination $caCerPublicPath -Force

$b64 = [Convert]::ToBase64String($ca.RawData, [Base64FormattingOptions]::InsertLineBreaks)
$pem = "-----BEGIN CERTIFICATE-----`r`n$b64`r`n-----END CERTIFICATE-----`r`n"
[IO.File]::WriteAllText($caPemPath, $pem, (New-Object Text.UTF8Encoding($false)))

# Instalar la CA en el almacen del usuario actual para que Windows/Chrome confien.
$certutil = Join-Path $env:SystemRoot 'System32\certutil.exe'
if (Test-Path $certutil) {
  & $certutil -user -addstore Root $caCerPath | Out-Null
}

# El certificado del servidor ya esta dentro del PFX; no hace falta dejarlo en el almacen.
try { Remove-Item "Cert:\CurrentUser\My\$($server.Thumbprint)" -Force -ErrorAction SilentlyContinue } catch {}

Write-Host ''
Write-Host 'Certificado generado correctamente.' -ForegroundColor Green
Write-Host ''
Write-Host 'En esta computadora:' -ForegroundColor Cyan
Write-Host '  Abre https://127.0.0.1:3443'
Write-Host ''
Write-Host 'En el celular:' -ForegroundColor Cyan
Write-Host '  1. Conectate a la misma Wi-Fi.'
Write-Host '  2. Abre en el navegador del celular:'
foreach ($ip in $ips) {
  if ($ip -ne '127.0.0.1') {
    Write-Host "     http://${ip}:3000/isim-ca.crt" -ForegroundColor Yellow
  }
}
Write-Host '  3. Instala ese certificado como "Certificado de CA".'
Write-Host '  4. Luego escanea el QR (usara https://...:3443).'
Write-Host ''
Write-Host 'Si cambia la IP del equipo, vuelve a ejecutar este script.' -ForegroundColor Gray
Write-Host ''