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
$nodeSource=(Get-Command node.exe -ErrorAction Stop).Source
if(-not(Test-Path -LiteralPath $opensslSource)){throw 'Git for Windows OpenSSL runtime is unavailable'}
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

# Parse PE import tables directly so package creation does not depend on objdump/dumpbin.
function Convert-PeRvaToOffset([byte[]]$Bytes,[int]$PeOffset,[int]$SectionCount,[int]$OptionalHeaderSize,[uint32]$Rva) {
  $sectionTable=$PeOffset+24+$OptionalHeaderSize
  for($index=0;$index -lt $SectionCount;$index++){
    $section=$sectionTable+($index*40)
    $virtualSize=[int64][BitConverter]::ToUInt32($Bytes,$section+8)
    $virtualAddress=[int64][BitConverter]::ToUInt32($Bytes,$section+12)
    $rawSize=[int64][BitConverter]::ToUInt32($Bytes,$section+16)
    $rawPointer=[int64][BitConverter]::ToUInt32($Bytes,$section+20)
    $span=[Math]::Max($virtualSize,$rawSize)
    if([int64]$Rva -ge $virtualAddress -and [int64]$Rva -lt ($virtualAddress+$span)){
      $delta=[int64]$Rva-$virtualAddress
      if($delta -ge $rawSize){throw 'PE import table references an uninitialized section range.'}
      return [int]($rawPointer+$delta)
    }
  }
  throw ('PE RVA {0} does not map to a file section.' -f $Rva)
}
function Get-PeImportedDlls([string]$Path) {
  $bytes=[System.IO.File]::ReadAllBytes($Path)
  if($bytes.Length -lt 64 -or [Text.Encoding]::ASCII.GetString($bytes,0,2) -ne 'MZ'){throw "Invalid PE executable: $Path"}
  $peOffset=[BitConverter]::ToInt32($bytes,0x3c)
  if($peOffset -lt 0 -or $peOffset+24 -gt $bytes.Length -or [Text.Encoding]::ASCII.GetString($bytes,$peOffset,4) -ne ('PE'+[char]0+[char]0)){throw "Invalid PE header: $Path"}
  $sectionCount=[BitConverter]::ToUInt16($bytes,$peOffset+6)
  $optionalSize=[BitConverter]::ToUInt16($bytes,$peOffset+20)
  $optionalOffset=$peOffset+24
  if($optionalOffset+$optionalSize -gt $bytes.Length){throw "Truncated PE optional header: $Path"}
  $magic=[BitConverter]::ToUInt16($bytes,$optionalOffset)
  if($magic -eq 0x10b){$directoryOffset=96}
  elseif($magic -eq 0x20b){$directoryOffset=112}
  else{throw "Unsupported PE optional header: $Path"}
  if($directoryOffset+16 -gt $optionalSize){throw "PE data directories are truncated: $Path"}
  $directoryCount=[BitConverter]::ToUInt32($bytes,$optionalOffset+$directoryOffset-4)
  if($directoryCount -lt 2){return @()}
  $importRva=[BitConverter]::ToUInt32($bytes,$optionalOffset+$directoryOffset+8)
  if($importRva -eq 0){return @()}
  $importOffset=Convert-PeRvaToOffset $bytes $peOffset $sectionCount $optionalSize $importRva
  $imports=[System.Collections.Generic.List[string]]::new()
  for($index=0;$index -lt 4096;$index++){
    $descriptor=$importOffset+($index*20)
    if($descriptor+20 -gt $bytes.Length){throw "PE import descriptor table is truncated: $Path"}
    $nameRva=[BitConverter]::ToUInt32($bytes,$descriptor+12)
    if($nameRva -eq 0){break}
    $nameOffset=Convert-PeRvaToOffset $bytes $peOffset $sectionCount $optionalSize $nameRva
    $end=$nameOffset
    while($end -lt $bytes.Length -and $bytes[$end] -ne 0){$end++}
    if($end -eq $bytes.Length){throw "PE import name is unterminated: $Path"}
    $name=[Text.Encoding]::ASCII.GetString($bytes,$nameOffset,$end-$nameOffset)
    if($name){$imports.Add($name)}
  }
  if($index -eq 4096){throw "PE import descriptor limit exceeded: $Path"}
  return $imports.ToArray()
}

# Collect non-system DLL dependencies recursively; do not copy unrelated Git executables.
$queue=[System.Collections.Generic.Queue[string]]::new()
$queue.Enqueue($opensslSource)
$copied=@{}
while($queue.Count -gt 0){
  $current=$queue.Dequeue()
  foreach($name in (Get-PeImportedDlls $current)){
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
