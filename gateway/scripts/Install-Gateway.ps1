[CmdletBinding()]
param(
  [string]$InstallDirectory = "$env:ProgramFiles\SmartInventoryGateway",
  [string]$DataDirectory = "$env:ProgramData\SmartInventoryGateway\data",
  [string]$BindAddress = '127.0.0.1',
  [ValidateRange(1024,65535)][int]$Port = 8443,
  [switch]$EnableLan,
  [switch]$EnableAutostart,
  [switch]$Reconfigure,
  [switch]$NoFirewall,
  [switch]$NoAutostart,
  [switch]$NoStart
)
$ErrorActionPreference='Stop'

function Assert-Administrator {
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=[Security.Principal.WindowsPrincipal]::new($identity)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw 'Run Install-Gateway.ps1 from an elevated PowerShell session.'
  }
}
function Test-PrivateAddress([string]$Value) {
  try {$ip=[System.Net.IPAddress]::Parse($Value)} catch {return $false}
  if([System.Net.IPAddress]::IsLoopback($ip)){return $true}
  if($ip.IsIPv4MappedToIPv6){return $false}
  $bytes=$ip.GetAddressBytes()
  if($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork){
    return ($bytes[0] -eq 10) -or
      ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
      ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
  }
  if($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6){
    return (($bytes[0] -band 0xFE) -eq 0xFC)
  }
  return $false
}
function Set-PrivateAcl([string]$Path) {
  $account="$env:USERDOMAIN\$env:USERNAME"
  & icacls.exe $Path '/inheritance:r' '/grant:r' ($account + ':(OI)(CI)F') 'SYSTEM:(OI)(CI)F' '/T' '/C' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Unable to restrict Gateway data directory ACLs.'}
}
function Register-GatewayTask([string]$Root,[string]$Data) {
  $taskName='Smart Inventory Gateway'
  $startScript=Join-Path $Root 'Start-Gateway.ps1'
  $powershell=(Get-Command powershell.exe).Source
  $arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$startScript+'" -DataDirectory "'+$Data+'"'
  $action=New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $Root
  $user="$env:USERDOMAIN\$env:USERNAME"
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}

Assert-Administrator
if([string]::IsNullOrWhiteSpace($InstallDirectory) -or [string]::IsNullOrWhiteSpace($DataDirectory)){throw 'InstallDirectory and DataDirectory are required.'}
$sourceRoot=$PSScriptRoot
$install=([System.IO.Path]::GetFullPath($InstallDirectory)).TrimEnd('\')
$data=([System.IO.Path]::GetFullPath($DataDirectory)).TrimEnd('\')
if($install -eq $data -or $data.StartsWith($install+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'DataDirectory must be outside InstallDirectory so upgrades cannot replace persistent state.'}

# Stop an existing installation before replacing its executable files.
$oldStop=Join-Path $install 'Stop-Gateway.ps1'
if(Test-Path -LiteralPath $oldStop){& $oldStop -DataDirectory $data}
New-Item -ItemType Directory -Force -Path $install,$data | Out-Null
Set-PrivateAcl $data

# Copy the self-contained release while keeping configuration and state outside the install directory.
Get-ChildItem -LiteralPath $sourceRoot -Force |
  Where-Object {$_.Name -notin @('Install-Gateway.ps1','Uninstall-Gateway.ps1','Start-Gateway.ps1','Stop-Gateway.ps1','Export-CA.ps1')} |
  ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $install -Recurse -Force}
foreach($name in @('Install-Gateway.ps1','Uninstall-Gateway.ps1','Start-Gateway.ps1','Stop-Gateway.ps1','Export-CA.ps1')){
  Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $install -Force
}

$node=Join-Path $install 'runtime\node.exe'
$openssl=Join-Path $install 'runtime\openssl\openssl.exe'
$opensslConfig=Join-Path $install 'runtime\openssl\openssl.cnf'
if(-not(Test-Path -LiteralPath $node) -or -not(Test-Path -LiteralPath $openssl) -or -not(Test-Path -LiteralPath $opensslConfig)){
  throw 'The release package is missing its bundled Node.js or OpenSSL runtime.'
}
$configPath=Join-Path $data 'gateway.config.json'
$existing=$null
if(Test-Path -LiteralPath $configPath){
  try {$existing=Get-Content -LiteralPath $configPath -Raw|ConvertFrom-Json} catch {throw 'Existing Gateway configuration is invalid; it was not overwritten.'}
}
if($existing -and -not $Reconfigure){
  $effectiveHost=[string]$existing.host
  $effectivePort=[int]$existing.port
  $tls=$existing.tls
  if($tls.mode -eq 'local-ca'){
    $tls.opensslPath=$openssl
    $tls.opensslConfigPath=$opensslConfig
  }
}else{
  $effectiveHost=$BindAddress
  $effectivePort=$Port
  $tls=[ordered]@{mode='local-ca';opensslPath=$openssl;opensslConfigPath=$opensslConfig;renewBeforeDays=30}
}
if(-not(Test-PrivateAddress $effectiveHost)){throw 'Bind address must be an explicit loopback, RFC1918 IPv4 or IPv6 ULA address; wildcard, public and link-local addresses are rejected.'}
if($effectivePort -lt 1024 -or $effectivePort -gt 65535){throw 'Gateway port must be between 1024 and 65535.'}
$isLoopback=[System.Net.IPAddress]::IsLoopback([System.Net.IPAddress]::Parse($effectiveHost))
if(-not $isLoopback -and -not $EnableLan){throw 'LAN binding requires the explicit -EnableLan switch, including on upgrades.'}
$config=[ordered]@{host=$effectiveHost;port=$effectivePort;dataDir=$data;tls=$tls}
$tempConfig=$configPath+'.next'
$config|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $tempConfig -Encoding utf8
Move-Item -LiteralPath $tempConfig -Destination $configPath -Force

$firewallName='Smart Inventory Gateway'
if(-not $isLoopback -and -not $NoFirewall){
  Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue|Remove-NetFirewallRule
  $rule=@{DisplayName=$firewallName;Direction='Inbound';Action='Allow';Enabled='True';Program=$node;
    Protocol='TCP';LocalAddress=$effectiveHost;LocalPort=$effectivePort;RemoteAddress='LocalSubnet';Profile='Private'}
  New-NetFirewallRule @rule | Out-Null
}elseif($isLoopback){
  Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue|Remove-NetFirewallRule
}

$task=Get-ScheduledTask -TaskName 'Smart Inventory Gateway' -ErrorAction SilentlyContinue
if(($EnableAutostart -or $task) -and -not $NoAutostart){Register-GatewayTask $install $data}

Write-Output "Gateway installed: $install"
Write-Output "Persistent data: $data"
Write-Output ('HTTPS endpoint: https://{0}:{1}' -f $effectiveHost,$effectivePort)
if(-not $isLoopback){Write-Output 'Firewall rule is restricted to the Private profile and LocalSubnet. The Windows network profile must be Private.'}
Write-Output 'No Windows/iOS trust store was modified.'
if(-not $NoStart){
  & (Join-Path $install 'Start-Gateway.ps1') -DataDirectory $data
  Write-Output "First-run setup token file: $(Join-Path $data 'setup-token.txt')"
}
