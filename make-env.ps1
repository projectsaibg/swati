# Generates a local dev .env with strong random secrets. Safe to re-run.
$root = $PSScriptRoot
$pg    = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 20 | ForEach-Object {[char]$_})
$minio = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 20 | ForEach-Object {[char]$_})
$acc = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$ref = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$content = @"
POSTGRES_USER=swati
POSTGRES_PASSWORD=$pg
POSTGRES_DB=swati
DATABASE_URL=postgresql://swati:$pg@db:5432/swati?schema=public
JWT_ACCESS_SECRET=$acc
JWT_REFRESH_SECRET=$ref
MINIO_ROOT_USER=swati-minio
MINIO_ROOT_PASSWORD=$minio
S3_BUCKET=swati-evidence
PUBLIC_BASE_URL=http://localhost:5173
"@
Set-Content -Path (Join-Path $root ".env") -Value $content -Encoding utf8
Write-Host ".env created at $root"
