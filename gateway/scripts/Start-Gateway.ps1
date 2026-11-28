param([Parameter(Mandatory=$true)][string]$DataDirectory)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$data=[System.IO.Path]::GetFullPath($DataDirectory)
$node=Join-Path $root 'runtime\node.exe'
$server=Join-Path $root 'app\gateway\src\server.mjs'
$config=Join-Path $data 'gateway.config.json'
$pidFile=Join-Path $data 'gateway.pid'
$stdout=Join-Path $data 'gateway.log'
$stderr=Join-Path $data 'gateway-error.log'
if(-not(Test-Path -LiteralPath $node) -or -not(Test-Path -LiteralPath $server) -or -not(Test-Path -LiteralPath $config)){
  throw 'Gateway runtime, server entrypoint or configuration is missing.'
}
if(Test-Path -LiteralPath $pidFile){
  $oldPid=0
  if([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(),[ref]$oldPid)){
    $old=Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if($old -and $old.Path -eq $node){Write-Output "Gateway already running (PID $oldPid)";exit 0}
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
$arguments='"'+$server+'" --config "'+$config+'"'
$startParams=@{FilePath=$node;ArgumentList=$arguments;WorkingDirectory=(Split-Path $server -Parent);WindowStyle='Hidden';PassThru=$true;RedirectStandardOutput=$stdout;RedirectStandardError=$stderr}
$process=Start-Process @startParams
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
$ready=$false
for($i=0;$i -lt 40;$i++){
  Start-Sleep -Milliseconds 500
  $current=Get-Process -Id $process.Id -ErrorAction SilentlyContinue
  if(-not $current){
    $details=''
    if(Test-Path $stderr){$details=(Get-Content $stderr -Tail 30)-join [Environment]::NewLine}
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw "Gateway exited during startup. $details"
  }
  if(Test-Path $stdout){
    if((Get-Content $stdout -Raw) -match 'Gateway HTTPS listening'){$ready=$true;break}
  }
}
if(-not $ready){
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  throw "Gateway process $($process.Id) did not report HTTPS readiness within 20 seconds. Check $stdout and $stderr"
}
Write-Output "Gateway started (PID $($process.Id)). Logs: $stdout"
