$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $repositoryRoot "extension"
$manifestPath = Join-Path $extensionRoot "manifest.json"
$distributionRoot = Join-Path $repositoryRoot "dist"

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Không tìm thấy manifest: $manifestPath"
}

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') {
    throw "Version không hợp lệ trong manifest: $version"
}

New-Item -ItemType Directory -Path $distributionRoot -Force | Out-Null
$archiveName = "NOTA_Labeling_Organizer_Extension_v$version.zip"
$archivePath = Join-Path $distributionRoot $archiveName
$temporaryPath = Join-Path $distributionRoot "$archiveName.new.zip"

if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
}

# Compress-Archive in Windows PowerShell 5.1 stores "\" separators; the ZIP spec requires "/".
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$extensionPrefix = (Get-Item -LiteralPath $extensionRoot).FullName.TrimEnd('\') + '\'
$archive = [System.IO.Compression.ZipFile]::Open($temporaryPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $extensionRoot -File -Recurse) {
        $entryName = $file.FullName.Substring($extensionPrefix.Length).Replace('\', '/')
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    }
} finally {
    $archive.Dispose()
}
Move-Item -LiteralPath $temporaryPath -Destination $archivePath -Force

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath
Write-Host "Đã tạo: $archivePath"
Write-Host "SHA256: $($hash.Hash)"
