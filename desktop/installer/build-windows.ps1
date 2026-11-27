param([Parameter(Mandatory)][string]$Nsis)

$ErrorActionPreference = "Stop"
$version = node -p "require('./package.json').version"
if ($LASTEXITCODE -ne 0 -or -not $version) { throw "Version de Plume introuvable" }

$source = Join-Path $PWD "dist\win-unpacked"
$app = Join-Path $source "Plume.exe"
$setup = Join-Path $PWD "dist\Plume-Setup-$version-x64.exe"
$certificate = $null
$existingThumbprints = @()
$imported = @()
$pfx = $null
$releaseRef = $env:GITHUB_REF -like 'refs/heads/release/*' -or $env:GITHUB_REF -like 'refs/tags/v*'

function Sign-PlumeExecutable([string]$File) {
    & $signtool sign /sha1 $certificate.Thumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $File
    if ($LASTEXITCODE -ne 0) { throw "Échec de la signature de $File" }
    & $signtool verify /pa /tw $File
    if ($LASTEXITCODE -ne 0) { throw "Signature ou horodatage invalide pour $File" }
    $signature = Get-AuthenticodeSignature -FilePath $File
    if ($signature.Status -ne 'Valid' -or
        $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint -or
        -not $signature.TimeStamperCertificate) {
        throw "Certificat ou horodatage inattendu pour $File"
    }
}

try {
    if ($env:PLUME_WINDOWS_PFX_B64 -or $env:PLUME_WINDOWS_PFX_PASSWORD) {
        if (-not $env:PLUME_WINDOWS_PFX_B64 -or -not $env:PLUME_WINDOWS_PFX_PASSWORD -or
            $env:PLUME_WINDOWS_CERT_SHA256 -notmatch '^[a-fA-F0-9]{64}$') {
            throw "La signature Windows exige un PFX, son mot de passe et une empreinte SHA-256 valide"
        }
        $sdkBin = Join-Path "${env:ProgramFiles(x86)}" "Windows Kits\10\bin"
        $signtool = Get-ChildItem $sdkBin -Recurse -Filter signtool.exe |
            Where-Object { $_.Directory.Name -eq 'x64' } |
            Sort-Object FullName -Descending | Select-Object -ExpandProperty FullName -First 1
        if (-not $signtool) { throw "SignTool x64 introuvable dans le SDK Windows" }

        $pfx = Join-Path ([IO.Path]::GetTempPath()) ("plume-" + [Guid]::NewGuid() + ".pfx")
        [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:PLUME_WINDOWS_PFX_B64))
        $password = ConvertTo-SecureString $env:PLUME_WINDOWS_PFX_PASSWORD -AsPlainText -Force
        $existingThumbprints = @(Get-ChildItem Cert:\CurrentUser\My | Select-Object -ExpandProperty Thumbprint)
        $imported = @(Import-PfxCertificate -FilePath $pfx -Password $password -CertStoreLocation Cert:\CurrentUser\My)
        Remove-Item Env:\PLUME_WINDOWS_PFX_B64, Env:\PLUME_WINDOWS_PFX_PASSWORD
        $matching = @($imported | Where-Object { $_.HasPrivateKey -and
            $_.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256) -eq $env:PLUME_WINDOWS_CERT_SHA256 })
        if ($matching.Count -ne 1) { throw "Le PFX ne contient pas le certificat Windows attendu" }
        $certificate = $matching[0]
        Sign-PlumeExecutable $app
    } elseif ($releaseRef -and $env:PLUME_REQUIRE_SIGNED_RELEASE -eq 'true') {
        throw "La signature Windows est exigée pour cette publication"
    } else {
        Write-Warning "Aucun certificat Windows configuré. Les exécutables Plume sont non signés."
    }

    $icon = Join-Path $PWD "build\icon.ico"
    & $Nsis "/DVERSION=$version" "/DSRC=$source" "/DOUT=$setup" "/DICON=$icon" installer\plume.nsi
    if ($LASTEXITCODE -ne 0) { throw "La compilation NSIS a échoué" }
    if ($certificate) { Sign-PlumeExecutable $setup }

    New-Item -ItemType Directory -Force ..\out | Out-Null
    Copy-Item -Recurse $source Plume
    Compress-Archive -Path Plume -DestinationPath "..\out\Plume-Portable-$version-x64.zip"
    Copy-Item $setup ..\out\
} finally {
    if ($pfx -and (Test-Path $pfx)) { Remove-Item -LiteralPath $pfx -Force }
    foreach ($item in $imported) {
        if ($item.Thumbprint -notin $existingThumbprints) {
            Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($item.Thumbprint)" -DeleteKey -ErrorAction SilentlyContinue
        }
    }
}
