param([Parameter(Mandatory=$true)][string]$PackageDirectory,[Parameter(Mandatory=$true)][string]$Workspace)
$ErrorActionPreference='Stop'
$script:capturedFirewall=$null
$script:capturedTask=$null
function Get-NetFirewallRule { return $null }
function Remove-NetFirewallRule { param([string]$DisplayName) }
function New-NetFirewallRule {
  param([string]$DisplayName,[string]$Direction,[string]$Action,[string]$Enabled,[string]$Program,[string]$Protocol,[string]$LocalAddress,[int]$LocalPort,[string]$RemoteAddress,[string]$Profile)
  $script:capturedFirewall=@{DisplayName=$DisplayName;Direction=$Direction;Action=$Action;Enabled=$Enabled;Program=$Program;Protocol=$Protocol;LocalAddress=$LocalAddress;LocalPort=$LocalPort;RemoteAddress=$RemoteAddress;Profile=$Profile}
}
function Get-ScheduledTask { return $null }
function New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory); return @{Execute=$Execute;Argument=$Argument;WorkingDirectory=$WorkingDirectory} }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn,$User); return @{AtLogOn=$AtLogOn.IsPresent;User=$User} }
function New-ScheduledTaskPrincipal { param($UserId,$LogonType,$RunLevel); return @{UserId=$UserId;LogonType=$LogonType;RunLevel=$RunLevel} }
function New-ScheduledTaskSettingsSet { param([switch]$StartWhenAvailable,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries); return @{StartWhenAvailable=$StartWhenAvailable.IsPresent} }
function Register-ScheduledTask { param($TaskName,$Action,$Trigger,$Principal,$Settings,[switch]$Force); $script:capturedTask=@{TaskName=$TaskName;Action=$Action;Trigger=$Trigger;Principal=$Principal;Settings=$Settings} }
function Unregister-ScheduledTask { [CmdletBinding()] param([string]$TaskName,[switch]$Confirm) }

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

# Complete first-run setup over HTTPS with a synthetic password and the exported CA; no TLS bypass.
$setupScript=Join-Path $install 'Complete-FirstRunSetup.ps1'
$syntheticPassword=ConvertTo-SecureString 'Synthetic-Gateway-Password-2026!' -AsPlainText -Force
& $setupScript -DataDirectory $data -Password $syntheticPassword
if(Test-Path (Join-Path $data 'setup-token.txt')){throw 'First-run setup token was not consumed.'}
$endpointFile=Join-Path $data 'gateway.endpoint.txt'
if(-not(Test-Path $endpointFile)){throw 'Configured HTTPS endpoint was not persisted.'}
if((Get-Content $endpointFile -Raw).Trim() -ne ('https://127.0.0.1:'+ $port)){throw 'Persisted HTTPS endpoint does not match the configured listener.'}
if($script:capturedTask){throw 'Autostart was registered despite -NoAutostart.'}

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
# Exercise explicit LAN/firewall/autostart consent with synthetic addresses and mocked OS commands.
$policyDeniedInstall=Join-Path $workspace 'policy-denied-install'
$policyDeniedData=Join-Path $workspace 'policy-denied-data'
try{
  & $installer -InstallDirectory $policyDeniedInstall -DataDirectory $policyDeniedData -BindAddress '192.168.50.25' -Port 18443 -NoStart
  throw 'LAN binding was accepted without explicit -EnableLan consent.'
}catch{
  if($_.Exception.Message -notmatch 'LAN binding requires the explicit -EnableLan switch'){throw}
}
if($script:capturedFirewall){throw 'Firewall rule was created without explicit LAN consent.'}
$policyInstall=Join-Path $workspace 'policy-install'
$policyData=Join-Path $workspace 'policy-data'
$script:capturedFirewall=$null;$script:capturedTask=$null
& $installer -InstallDirectory $policyInstall -DataDirectory $policyData -BindAddress '192.168.50.25' -Port 18443 -EnableLan -EnableAutostart -NoStart
if(-not $script:capturedFirewall -or $script:capturedFirewall.LocalAddress -ne '192.168.50.25' -or $script:capturedFirewall.LocalPort -ne 18443 -or $script:capturedFirewall.Profile -ne 'Private' -or $script:capturedFirewall.RemoteAddress -ne 'LocalSubnet' -or $script:capturedFirewall.Program -ne (Join-Path $policyInstall 'runtime\node.exe')){throw 'LAN firewall rule is not restricted to the explicit private bind and local subnet.'}
if(-not $script:capturedTask -or $script:capturedTask.TaskName -ne 'Smart Inventory Gateway' -or $script:capturedTask.Trigger.AtLogOn -ne $true){throw 'Explicit optional autostart did not register the expected per-user logon task.'}
$policyEndpoint=Get-Content (Join-Path $policyData 'gateway.endpoint.txt') -Raw
if($policyEndpoint.Trim() -ne 'https://192.168.50.25:18443'){throw 'Stable configured endpoint does not match the selected bind address.'}
Write-Output "Windows package smoke passed. Node=$nodeVersion OpenSSL=$opensslVersion CA fingerprint=$fingerprint; first-run HTTPS setup, explicit LAN policy and optional autostart verified with synthetic data and mocked OS commands."
