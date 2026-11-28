[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [Security.SecureString]$Password
)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$node=Join-Path $root 'runtime\node.exe'
$nodeScript=Join-Path $root 'first-run-setup.mjs'
$data=[System.IO.Path]::GetFullPath($DataDirectory)
$configPath=Join-Path $data 'gateway.config.json'
$tokenPath=Join-Path $data 'setup-token.txt'
$caPath=Join-Path $data 'tls\root-ca.crt'
foreach($path in @($node,$nodeScript,$configPath,$tokenPath,$caPath)){if(-not(Test-Path -LiteralPath $path)){throw 'Gateway runtime, configuration, setup token or local CA is missing.'}}
$config=Get-Content -LiteralPath $configPath -Raw|ConvertFrom-Json
if(-not $config.host -or -not $config.port){throw 'Gateway endpoint configuration is invalid.'}
if(-not $Password){$Password=Read-Host 'Choose a Gateway administrator password (at least 12 characters)' -AsSecureString}
$pointer=[IntPtr]::Zero
$process=$null
try{
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
  $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if($plain.Length -lt 12){throw 'Administrator password must contain at least 12 characters.'}
  $token=(Get-Content -LiteralPath $tokenPath -Raw).Trim()
  if(-not $token){throw 'The one-time setup token is empty.'}
  $authority=if(([string]$config.host).Contains(':')){'['+$config.host+']'}else{$config.host}
  $endpoint='https://'+$authority+':'+$config.port+'/api/v1/setup'
  $payload=@{setupToken=$token;password=$plain}|ConvertTo-Json -Compress
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$node
  $psi.Arguments='"'+$nodeScript+'" "'+$endpoint+'"'
  $psi.WorkingDirectory=$root
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.RedirectStandardInput=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  $psi.EnvironmentVariables['NODE_EXTRA_CA_CERTS']=$caPath
  $process=[Diagnostics.Process]::Start($psi)
  $bytes=[Text.Encoding]::UTF8.GetBytes($payload)
  $process.StandardInput.BaseStream.Write($bytes,0,$bytes.Length)
  $process.StandardInput.BaseStream.Flush()
  $process.StandardInput.Close()
  $stdout=$process.StandardOutput.ReadToEnd()
  $stderr=$process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if($process.ExitCode -ne 0){throw 'Gateway first-run setup failed. Verify the endpoint and local CA, then retry.'}
  if($stdout.Trim()){Write-Output $stdout.Trim()}
}finally{
  if($process){$process.Dispose()}
  if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
  $plain=$null;$payload=$null;$token=$null;$bytes=$null
}
