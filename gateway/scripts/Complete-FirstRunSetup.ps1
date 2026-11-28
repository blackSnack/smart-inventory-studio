[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [Security.SecureString]$Password
)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$node=Join-Path $root 'runtime\node.exe'
$data=[System.IO.Path]::GetFullPath($DataDirectory)
$configPath=Join-Path $data 'gateway.config.json'
$tokenPath=Join-Path $data 'setup-token.txt'
$caPath=Join-Path $data 'tls\root-ca.crt'
foreach($path in @($node,$configPath,$tokenPath,$caPath)){if(-not(Test-Path -LiteralPath $path)){throw 'Gateway runtime, configuration, setup token or local CA is missing.'}}
$config=Get-Content -LiteralPath $configPath -Raw|ConvertFrom-Json
if(-not $config.host -or -not $config.port){throw 'Gateway endpoint configuration is invalid.'}
if(-not $Password){$Password=Read-Host 'Choose a Gateway administrator password (at least 12 characters)' -AsSecureString}
$pointer=[IntPtr]::Zero
$previousEncoding=$OutputEncoding
$previousCa=$env:NODE_EXTRA_CA_CERTS
try{
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
  $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if($plain.Length -lt 12){throw 'Administrator password must contain at least 12 characters.'}
  $token=(Get-Content -LiteralPath $tokenPath -Raw).Trim()
  if(-not $token){throw 'The one-time setup token is empty.'}
  $authority=if(([string]$config.host).Contains(':')){'['+$config.host+']'}else{$config.host}
  $endpoint='https://'+$authority+':'+$config.port+'/api/v1/setup'
  $env:NODE_EXTRA_CA_CERTS=$caPath
  $OutputEncoding=[Text.UTF8Encoding]::new($false)
  $payload=@{setupToken=$token;password=$plain}|ConvertTo-Json -Compress
  $nodeCode=@'
const endpoint=process.argv[1];
let raw='';
for await (const chunk of process.stdin) raw+=chunk;
let payload;
try { payload=JSON.parse(raw); } catch { console.error('Invalid setup input.'); process.exit(2); }
try {
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(endpoint).origin},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok||result?.authenticated!==true){console.error('Gateway setup failed (HTTP '+response.status+').');process.exit(1);}
  console.log('Gateway administrator setup completed. The one-time token was consumed; the password was not saved.');
} catch {
  console.error('Gateway setup could not reach the HTTPS endpoint using the configured local CA.');
  process.exit(1);
}
'@
  $payload|& $node -e $nodeCode $endpoint
  if($LASTEXITCODE -ne 0){throw 'Gateway first-run setup failed.'}
}finally{
  $OutputEncoding=$previousEncoding
  if($null -eq $previousCa){Remove-Item Env:NODE_EXTRA_CA_CERTS -ErrorAction SilentlyContinue}else{$env:NODE_EXTRA_CA_CERTS=$previousCa}
  if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
  $plain=$null;$payload=$null;$token=$null
}
