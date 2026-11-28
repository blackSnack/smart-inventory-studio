param([Parameter(Mandatory=$true)][string]$PackageDirectory,[Parameter(Mandatory=$true)][string]$Workspace)
$ErrorActionPreference='Stop'
$package=(Resolve-Path $PackageDirectory).Path
$workspace=[System.IO.Path]::GetFullPath($Workspace)
$install=Join-Path $workspace 'installed-gateway'
$data=Join-Path $workspace 'gateway-data'
$export=Join-Path $workspace 'ca-export-1'
$export2=Join-Path $workspace 'ca-export-2'
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
$listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
$listener.Start()
$port=$listener.LocalEndpoint.Port
$listener.Stop()

$installer=Join-Path $package 'Install-Gateway.ps1'
& $installer -InstallDirectory $install -DataDirectory $data -BindAddress '127.0.0.1' -Port $port -NoFirewall -NoAutostart -NoStart
$node=Join-Path $install 'runtime\node.exe'
$openssl=Join-Path $install 'runtime\openssl\openssl.exe'
if(-not(Test-Path $node) -or -not(Test-Path $openssl)){throw 'Packaged runtime files are missing.'}
$nodeVersion=(& $node --version).Trim()
$opensslVersion=(& $openssl version).Trim()
if($nodeVersion -notmatch '^v22\.' -or $opensslVersion -notmatch '^OpenSSL 3\.'){throw "Unexpected packaged runtime: $nodeVersion / $opensslVersion"}

$exportScript=Join-Path $install 'Export-CA.ps1'
& $exportScript -DataDirectory $data -OutputDirectory $export
$ca=Join-Path $export 'smart-inventory-local-ca.crt'
$profile=Join-Path $export 'smart-inventory-local-ca.mobileconfig'
if(-not(Test-Path $ca) -or -not(Test-Path $profile)){throw 'Public CA or iOS profile export is missing.'}
if(-not((Get-Content $profile -Raw).StartsWith('<?xml version="1.0"'))){throw 'iOS profile is not an XML property list.'}
$fingerprint=(Get-FileHash -LiteralPath $ca -Algorithm SHA256).Hash

$healthScript=Join-Path $workspace 'health-smoke.mjs'
@'
import fs from "node:fs";
import https from "node:https";
const [portText,caPath]=process.argv.slice(2);
const port=Number(portText),ca=fs.readFileSync(caPath);
let lastError;
for(let attempt=0;attempt<40;attempt++){
  try{
    const result=await new Promise((resolve,reject)=>{
      const req=https.get({hostname:"127.0.0.1",port,path:"/api/v1/health",ca,timeout:1500},res=>{
        let body="";res.setEncoding("utf8");res.on("data",chunk=>body+=chunk);
        res.on("end",()=>resolve({status:res.statusCode,body}));
      });
      req.on("error",reject);req.on("timeout",()=>req.destroy(new Error("health timeout")));
    });
    if(result.status!==200)throw new Error("unexpected health status "+result.status);
    const payload=JSON.parse(result.body);
    if(payload.service!=="smart-inventory-gateway"||payload.status!=="ok")throw new Error("invalid health payload");
    process.exit(0);
  }catch(error){lastError=error;await new Promise(resolve=>setTimeout(resolve,500));}
}
console.error(String(lastError));process.exit(1);
'@ | Set-Content -LiteralPath $healthScript -Encoding utf8

$start=Join-Path $install 'Start-Gateway.ps1'
$stop=Join-Path $install 'Stop-Gateway.ps1'
& $start -DataDirectory $data
& $node $healthScript $port $ca
if($LASTEXITCODE -ne 0){throw 'Packaged HTTPS health smoke failed.'}
& $stop -DataDirectory $data

# Upgrade in place must preserve the CA root and the persistent encryption/database files.
& $installer -InstallDirectory $install -DataDirectory $data -BindAddress '127.0.0.1' -Port $port -NoFirewall -NoAutostart -NoStart
& $exportScript -DataDirectory $data -OutputDirectory $export2
$fingerprint2=(Get-FileHash -LiteralPath (Join-Path $export2 'smart-inventory-local-ca.crt') -Algorithm SHA256).Hash
if($fingerprint2 -ne $fingerprint){throw 'Gateway upgrade changed the persistent root CA fingerprint.'}
& $start -DataDirectory $data
& $node $healthScript $port (Join-Path $export2 'smart-inventory-local-ca.crt')
if($LASTEXITCODE -ne 0){throw 'HTTPS health after upgrade failed.'}
& $stop -DataDirectory $data

# Invoke uninstall from outside the installation tree; persistent state must remain by default.
$uninstallCopy=Join-Path $workspace 'Uninstall-Gateway.ps1'
Copy-Item -LiteralPath (Join-Path $install 'Uninstall-Gateway.ps1') -Destination $uninstallCopy
& $uninstallCopy -InstallDirectory $install -DataDirectory $data
if(Test-Path $install){throw 'Uninstall did not remove Gateway binaries.'}
foreach($path in @((Join-Path $data 'secret.key'),(Join-Path $data 'gateway.sqlite'),(Join-Path $data 'tls\root-ca.key'))){
  if(-not(Test-Path $path)){throw "Uninstall removed persistent state unexpectedly: $path"}
}
Write-Output "Windows package smoke passed. Node=$nodeVersion OpenSSL=$opensslVersion CA fingerprint=$fingerprint"
