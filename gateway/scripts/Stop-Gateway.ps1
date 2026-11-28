param([Parameter(Mandatory=$true)][string]$DataDirectory)
$ErrorActionPreference='Stop'
$data=[System.IO.Path]::GetFullPath($DataDirectory)
$pidFile=Join-Path $data 'gateway.pid'
$node=Join-Path $PSScriptRoot 'runtime\node.exe'
if(-not(Test-Path -LiteralPath $pidFile)){Write-Output 'Gateway is not running (no PID file).';exit 0}
$processId=0
if(-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(),[ref]$processId)){
  Remove-Item -LiteralPath $pidFile -Force
  throw 'Gateway PID file is invalid.'
}
$process=Get-Process -Id $processId -ErrorAction SilentlyContinue
if($process){
  if($process.Path -ne $node){throw 'PID file does not identify the packaged Gateway Node.js process; refusing to stop an unrelated process.'}
  Stop-Process -Id $processId -Force
  try{Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue}catch{}
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Output 'Gateway stopped.'
