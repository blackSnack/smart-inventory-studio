# Smart Inventory Gateway — Windows x64 deployment

This ZIP contains a self-contained Node.js 22 and OpenSSL 3 runtime. It does not require a public domain, public CA, Docker, Git, a system-wide Node installation or a separately installed OpenSSL.

## Install

1. Extract the ZIP to a temporary folder.
2. Open PowerShell **as Administrator**.
3. Install loopback-only (default):

   ```powershell
   .\Install-Gateway.ps1
   ```

4. To make the Gateway reachable from a phone on the same private LAN, choose the PC's actual private IPv4 address from Windows network settings and explicitly enable LAN exposure:

   ```powershell
   .\Install-Gateway.ps1 -BindAddress 192.168.1.50 -EnableLan -EnableAutostart
   ```

   Replace the example address with the address assigned to this PC. Do not use `0.0.0.0`, a public IP, a link-local address or an address copied from another device. The installer does not scan network interfaces or change the Windows network profile.

`-EnableLan` is the explicit consent to expose the selected address and create a firewall rule. `-NoFirewall` skips rule creation. The LAN firewall rule is restricted to the selected local address, TCP port, **Private** network profile and `LocalSubnet` remote addresses. The configured endpoint is written to `gateway.endpoint.txt`; for a stable address across router restarts, reserve the selected address for this PC in the router or configure a static address yourself. The installer does not change network settings. If Windows currently classifies the network as Public, the rule will not open it; change the network profile yourself only if this is a trusted private network. No public-profile rule is created.

Default paths:

- Binaries: `C:\Program Files\SmartInventoryGateway`
- Persistent data and configuration: `C:\ProgramData\SmartInventoryGateway\data`
- First-run setup token: `C:\ProgramData\SmartInventoryGateway\data\setup-token.txt`
- Advertised HTTPS endpoint: `gateway.endpoint.txt` in the data directory
- Logs: `gateway.log` and `gateway-error.log` in the data directory

The data directory ACL is restricted to the installing account and SYSTEM. The installer does not import certificates into Windows or iOS trust stores.

## First-run administrator setup

After installation starts the Gateway, run the setup helper from the installed directory. It reads the one-time token from the protected data directory, prompts for a password (minimum 12 characters), and posts the setup request over HTTPS using the Gateway's local CA certificate. It does not disable TLS validation or add the CA to the Windows trust store:

```powershell
& 'C:\Program Files\SmartInventoryGateway\Complete-FirstRunSetup.ps1' -DataDirectory 'C:\ProgramData\SmartInventoryGateway\data'
```

The helper does not persist the administrator password or session. Sign in using the configured password when the PWA is available.

## Local CA and iPhone trust

Export the public root certificate and iOS profile:

```powershell
& 'C:\Program Files\SmartInventoryGateway\Export-CA.ps1' -DataDirectory 'C:\ProgramData\SmartInventoryGateway\data' -OutputDirectory "$env:USERPROFILE\Desktop\SmartInventoryGateway-CA"
```

Verify the printed SHA-256 fingerprint with the administrator through a trusted channel before installing the profile. On iPhone, install the `.mobileconfig` profile, then open **Settings → General → About → Certificate Trust Settings** and explicitly enable full trust for the Smart Inventory root CA. Installing the profile alone does not enable full trust.

The root CA and private key remain in the protected data directory. The iOS profile contains only the public CA certificate. Server certificates are issued for the exact configured private IP and renewed automatically; changing the bind IP reissues the leaf without replacing the root CA.

## Current software boundary

This installer increment delivers the Windows runtime, local CA, HTTPS listener, authenticated setup/login/session APIs, encrypted server-side upstream configuration and durable SQLite journal. At this stage the web root is not yet the completed PWA; full same-origin PWA and Inventory/AI business routes are being delivered by the remaining Gateway issues. The current smoke endpoint is:

`https://<configured-private-ip>:8443/api/v1/health`

Upstream URLs are HTTPS-only until the separate trusted-LAN HTTP policy (#171) is implemented and reviewed. Do not disable TLS validation.

## Start, stop and upgrade

```powershell
& 'C:\Program Files\SmartInventoryGateway\Start-Gateway.ps1' -DataDirectory 'C:\ProgramData\SmartInventoryGateway\data'
& 'C:\Program Files\SmartInventoryGateway\Stop-Gateway.ps1' -DataDirectory 'C:\ProgramData\SmartInventoryGateway\data'
```

If autostart was enabled, Task Scheduler starts the Gateway at the installing user's logon. It runs under that user account, not as a Windows service.

For an upgrade, extract the new ZIP and run its `Install-Gateway.ps1` again using the same `-InstallDirectory` and `-DataDirectory`. Repeat `-EnableLan` when the existing configuration binds to a LAN address. The installer preserves the data directory, root CA, encryption key, SQLite database and administrator setup; it updates only the packaged runtime and OpenSSL paths unless `-Reconfigure` is explicitly supplied.

## Uninstall and backup

Run `Uninstall-Gateway.ps1` from the installed directory in elevated PowerShell. It stops the process, removes the scheduled task, firewall rule and binaries, but **preserves persistent data by default**.

To remove the CA, encryption key, SQLite database and configuration as well, pass `-RemoveData` and type `DELETE` at the confirmation prompt.

Back up the Gateway while stopped. Keep these together:

- `gateway.config.json`
- `secret.key`
- `gateway.sqlite`
- `tls\root-ca.key`
- `tls\root-ca.crt`

The SQLite database cannot decrypt stored upstream credentials without the matching `secret.key`. A missing or corrupt key causes startup to fail closed; it is never silently regenerated for an existing database.

## Verification

The Windows GitHub Actions package smoke test installs into an isolated temporary directory, runs the bundled Node/OpenSSL binaries, exports the CA, establishes a trusted HTTPS health connection, performs an in-place upgrade and verifies the root fingerprint is unchanged, then uninstalls while confirming persistent state remains. It does not add any OS trust or firewall rule in CI.
