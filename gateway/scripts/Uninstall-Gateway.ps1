[CmdletBinding()]
param(
  [string]$InstallDirectory = $PSScriptRoot,
  [string]$DataDirectory = "$env:ProgramData\SmartInventoryGateway\data",
  [switch]$RemoveData
)
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run Uninstall-Gateway.ps1 from an elevated PowerShell session.'}
$install=[System.IO.Path]::GetFullPath($InstallDirectory)
$data=[System.IO.Path]::GetFullPath($DataDirectory)
$stop=Join-Path $install 'Stop-Gateway.ps1'
if(Test-Path $stop){& $stop -DataDirectory $data}
Unregister-ScheduledTask -TaskName 'Smart Inventory Gateway' -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName 'Smart Inventory Gateway' -ErrorAction SilentlyContinue|Remove-NetFirewallRule
if($RemoveData){
  $confirmation=Read-Host "Type DELETE to permanently remove Gateway CA, encryption key, SQLite journal and configuration under $data"
  if($confirmation -cne 'DELETE'){throw 'Data removal cancelled.'}
  if(Test-Path $data){
    $account="$env:USERDOMAIN\$env:USERNAME"
    & icacls.exe $data '/grant' ($account + ':(OI)(CI)F') '/T' '/C' | Out-Null
    Remove-Item -LiteralPath $data -Recurse -Force
  }
}
Remove-Item -LiteralPath $install -Recurse -Force
Write-Output 'Gateway binaries and scheduled task removed.'
if(-not $RemoveData){Write-Output "Persistent data was preserved at $data"}
