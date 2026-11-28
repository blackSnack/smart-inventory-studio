param(
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [string]$OutputDirectory = (Join-Path $env:USERPROFILE 'Desktop\SmartInventoryGateway-CA')
)
$ErrorActionPreference='Stop'
$node=Join-Path $PSScriptRoot 'runtime\node.exe'
$cli=Join-Path $PSScriptRoot 'app\gateway\src\cli.mjs'
$config=Join-Path ([System.IO.Path]::GetFullPath($DataDirectory)) 'gateway.config.json'
if(-not(Test-Path -LiteralPath $config)){throw 'Gateway configuration not found.'}
& $node $cli ca export --config $config --out $OutputDirectory
if($LASTEXITCODE -ne 0){throw 'Local CA export failed.'}
Write-Output "Verify the SHA-256 fingerprint through a trusted channel before installing the profile."
