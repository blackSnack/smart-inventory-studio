param(
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$PackageName = 'SmartInventoryGateway'
)
$ErrorActionPreference='Stop'
$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$gatewayRoot=Join-Path $repoRoot 'gateway'
$gitRoot=Join-Path $env:ProgramFiles 'Git'
$gitBin=Join-Path $gitRoot 'usr\bin'
$opensslSource=Join-Path $gitBin 'openssl.exe'
$objdump=Join-Path $gitBin 'objdump.exe'
$nodeSource=(Get-Command node.exe -ErrorAction Stop).Source
if(-not(Test-Path -LiteralPath $opensslSource)){throw 'Git for Windows OpenSSL runtime is unavailable'}
if(-not(Test-Path -LiteralPath $objdump)){throw 'Git for Windows objdump is required to collect OpenSSL runtime dependencies'}
if(-not(Test-Path -LiteralPath (Join-Path $repoRoot 'dist\approved-snapshot.js'))){throw 'Shared TypeScript dist is missing; run npm run build:core first'}

$nodeVersion=(& $nodeSource --version).Trim()
$opensslVersion=(& $opensslSource version).Trim()
if($opensslVersion -notmatch '^OpenSSL 3\.'){throw "OpenSSL 3 is required; found: $opensslVersion"}

$out=(Resolve-Path (New-Item -ItemType Directory -Force -Path $OutputDirectory)).Path
$package=Join-Path $out $PackageName
if(Test-Path $package){Remove-Item $package -Recurse -Force}
$runtime=Join-Path $package 'runtime'
$opensslDir=Join-Path $runtime 'openssl'
$app=Join-Path $package 'app'
$null=New-Item -ItemType Directory -Force -Path $opensslDir,$app
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath $opensslSource -Destination (Join-Path $opensslDir 'openssl.exe')

# Collect non-system DLL dependencies recursively; do not copy unrelated Git executables.
$queue=[System.Collections.Generic.Queue[string]]::new()
$queue.Enqueue($opensslSource)
$copied=@{}
while($queue.Count -gt 0){
  $current=$queue.Dequeue()
  $lines=& $objdump -p $current 2>$null
  foreach($line in $lines){
    if("$line" -match 'DLL Name:\s*([^\s]+)'){
      $name=$Matches[1]
      if($name -match '^(api-ms-win-|ext-ms-win-)' -or
         (Test-Path -LiteralPath (Join-Path $env:WINDIR "System32\$name")) -or
         (Test-Path -LiteralPath (Join-Path $env:WINDIR "SysWOW64\$name"))){continue}
      if($copied.ContainsKey($name.ToLowerInvariant())){continue}
      $source=Join-Path $gitBin $name
      if(-not(Test-Path -LiteralPath $source)){
        $source=Join-Path (Join-Path $gitRoot 'mingw64\bin') $name
      }
      if(-not(Test-Path -LiteralPath $source)){throw "Unresolved OpenSSL runtime dependency: $name"}
      $copied[$name.ToLowerInvariant()]=$true
      Copy-Item -LiteralPath $source -Destination (Join-Path $opensslDir $name)
      $queue.Enqueue($source)
    }
  }
}

$opensslConfigCandidates=@(
  (Join-Path $gitRoot 'usr\ssl\openssl.cnf'),
  (Join-Path $gitRoot 'etc\ssl\openssl.cnf'),
  (Join-Path $gitRoot 'mingw64\ssl\openssl.cnf')
)
$opensslConfig=$opensslConfigCandidates|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
if(-not $opensslConfig){throw 'OpenSSL configuration file was not found in Git for Windows'}
Copy-Item -LiteralPath $opensslConfig -Destination (Join-Path $opensslDir 'openssl.cnf')
$modulesSource=Join-Path $gitRoot 'usr\lib\ossl-modules'
if(Test-Path -LiteralPath $modulesSource){Copy-Item -LiteralPath $modulesSource -Destination $opensslDir -Recurse}

$gatewayApp=Join-Path $app 'gateway'
$null=New-Item -ItemType Directory -Force -Path $gatewayApp
Copy-Item -LiteralPath (Join-Path $gatewayRoot 'src') -Destination $gatewayApp -Recurse
Copy-Item -LiteralPath (Join-Path $gatewayRoot 'package.json') -Destination $gatewayApp
Copy-Item -LiteralPath (Join-Path $gatewayRoot 'config.example.json') -Destination $gatewayApp
Copy-Item -LiteralPath (Join-Path $gatewayRoot 'README.md') -Destination $gatewayApp
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist') -Destination $app -Recurse
Set-Content -LiteralPath (Join-Path $app 'package.json') -Encoding utf8 -Value '{"private":true,"type":"module"}'

foreach($name in @('Install-Gateway.ps1','Uninstall-Gateway.ps1','Start-Gateway.ps1','Stop-Gateway.ps1','Export-CA.ps1')){
  $source=Join-Path $gatewayRoot "scripts\$name"
  if(-not(Test-Path -LiteralPath $source)){throw "Required installer script missing: $name"}
  Copy-Item -LiteralPath $source -Destination $package
}
$nodeLicense=Join-Path (Split-Path $nodeSource -Parent) 'LICENSE'
if(Test-Path -LiteralPath $nodeLicense){Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $package 'NODE-LICENSE.txt')}
$gitLicense=Join-Path $gitRoot 'LICENSE.txt'
if(Test-Path -LiteralPath $gitLicense){Copy-Item -LiteralPath $gitLicense -Destination (Join-Path $package 'GIT-FOR-WINDOWS-LICENSE.txt')}
$licenseRoot=Join-Path $gitRoot 'usr\share\licenses'
if(Test-Path -LiteralPath $licenseRoot){Copy-Item -LiteralPath $licenseRoot -Destination (Join-Path $package 'THIRD-PARTY-LICENSES') -Recurse}

$windowsReadme=Join-Path $gatewayRoot 'README-WINDOWS.md'
if(-not(Test-Path -LiteralPath $windowsReadme)){throw 'Windows deployment guide is missing'}
Copy-Item -LiteralPath $windowsReadme -Destination (Join-Path $package 'README-WINDOWS.md')

$manifest=[ordered]@{
  package=$PackageName
  architecture='win-x64'
  node=$nodeVersion
  openssl=$opensslVersion
  createdUtc=[DateTime]::UtcNow.ToString('o')
  runtimeFiles=@('runtime/node.exe','runtime/openssl/openssl.exe','runtime/openssl/openssl.cnf')
}
$manifest|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $package 'package-manifest.json') -Encoding utf8
$zip=Join-Path $out ($PackageName+'.zip')
if(Test-Path $zip){Remove-Item $zip -Force}
Compress-Archive -Path (Join-Path $package '*') -DestinationPath $zip -CompressionLevel Optimal
$zipHash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
Set-Content -LiteralPath ($zip+'.sha256') -Value $zipHash -Encoding ascii
Write-Output "Package: $package"
Write-Output "Archive: $zip"
Write-Output "Node: $nodeVersion"
Write-Output "OpenSSL: $opensslVersion"
Write-Output "OpenSSL DLL dependencies: $($copied.Count)"
